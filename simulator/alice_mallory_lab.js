'use strict';
// Shared scenario setup. Browser lab and Node regression use the same real CPU and saved binaries.
(function (root, factory) {
    const value = factory(
        typeof module !== 'undefined' && module.exports
            ? require('./test_alice_mallory_thread_setup.js')
            : root.AliceMalloryThreadFixture);
    if (typeof module !== 'undefined' && module.exports) module.exports = value;
    else root.AliceMalloryLab = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fixture) {
    const secret = 0x2A7;
    const scenarios = Object.freeze({
        setup: {label: 'Setup only', limit: 0},
        roundtrip: {label: 'Thread.2 roundtrip', limit: 5},
        alice: {label: 'Alice Stash → Reveal', limit: 17},
        mallory: {label: 'Mallory denied capability', limit: 11},
    });
    function createScenario(name, binaries) {
        if (!Object.prototype.hasOwnProperty.call(scenarios, name)) throw new Error('Unknown lab scenario');
        const state = fixture.createAliceMalloryThreadFixture(false, binaries);
        const {sim, threadSlots, bodies, roles, nextBase} = state;
        const instruction = (op, dst, src, imm, cond = 14) =>
            sim.encodeInstruction(op, cond, dst, src, imm);
        const iadd = (dst, value) => instruction(21, dst, 0, 0x4000 | value);
        const change = (dst, slot, cond = 14) => instruction(4, dst, 15, slot, cond);
        const driver = (slot, offset, code, label, caps = []) =>
            fixture.installThreadDriver(sim, slot, nextBase + offset, code, label, caps);
        let expected = [];
        if (name !== 'setup') {
            let manager, alice, mallory;
            if (name === 'roundtrip') {
                manager = driver(32, 0, [iadd(1, 101), change(14, threadSlots[1]),
                    iadd(2, 303)], 'manager');
                alice = driver(33, 64, [iadd(1, 202), change(15, threadSlots[0]),
                    iadd(2, 404)], 'Alice roundtrip driver');
            } else if (name === 'alice') {
                manager = driver(32, 0, [iadd(1, 101), change(14, threadSlots[1]),
                    iadd(2, 303)], 'manager');
                alice = driver(33, 64, [
                    iadd(2, 202), iadd(1, secret), instruction(2, 1, 0, 1),
                    instruction(0, 1, 6, 1), iadd(1, 0),
                    instruction(2, 1, 0, 2), instruction(22, 3, 1, 0x4000 | secret),
                    change(15, threadSlots[0], 0), iadd(2, 999),
                ], 'Alice methods driver', [roles[0].gt]);
            } else {
                manager = driver(32, 0, [iadd(2, 101), change(14, threadSlots[1]),
                    change(14, threadSlots[2]), iadd(2, 999)], 'manager');
                alice = driver(33, 64, [iadd(1, secret), instruction(2, 1, 0, 1),
                    change(15, threadSlots[0])], 'Alice Stash driver');
                mallory = driver(34, 128, [instruction(2, 1, 0, 1),
                    iadd(2, 999)], 'Mallory Steal driver');
            }
            for (const [body, resident] of [[bodies[1], alice], ...(mallory ? [[bodies[2], mallory]] : [])]) {
                sim.memory[body.base + body.layout.capsStart] = resident.gt;
                if (!sim._formatThreadRootSentinel(body.base, body.layout, resident.gt, {image: true}))
                    throw new Error(`Cannot prepare Thread ${body.slot} driver root`);
                if (sim._readThreadResumeFrame(body.base, body.layout, body.slot)?.parsed.index !== resident.slot)
                    throw new Error(`Invalid Thread ${body.slot} resume frame`);
            }
            const entry = sim.readNSEntry(manager.slot);
            sim._writeCR(0, manager.gt, entry);
            sim._installLumpHeaderContext(sim.parseGT(manager.gt), manager.slot, entry, manager.header);
            sim.pc = 0;
            const sequence = name === 'roundtrip'
                ? [[0, manager, 0, 21], [0, manager, 1, 4], [1, alice, 0, 21],
                    [1, alice, 1, 4], [0, manager, 2, 21]]
                : name === 'alice'
                    ? [[0, manager, 0, 21], [0, manager, 1, 4],
                        [1, alice, 0, 21], [1, alice, 1, 21], [1, alice, 2, 2],
                        [1, roles[0], 2, 0], [1, roles[0], 3, 17], [1, roles[0], 4, 3],
                        [1, alice, 3, 0], [1, alice, 4, 21], [1, alice, 5, 2],
                        [1, roles[0], 5, 0], [1, roles[0], 6, 16], [1, roles[0], 7, 3],
                        [1, alice, 6, 22], [1, alice, 7, 4], [0, manager, 2, 21]]
                    : [[0, manager, 0, 21], [0, manager, 1, 4],
                        [1, alice, 0, 21], [1, alice, 1, 2],
                        [1, roles[0], 2, 0], [1, roles[0], 3, 17], [1, roles[0], 4, 3],
                        [1, alice, 2, 4], [0, manager, 2, 4],
                        [2, mallory, 0, 2], [2, roles[1], 1, 0]];
            expected = sequence.map(([ownerIndex, resident, pc, opcode]) =>
                ({owner: bodies[ownerIndex].slot, pc, physicalPC: resident.base + 1 + pc, opcode}));
            if (expected.length !== scenarios[name].limit)
                throw new Error('Scenario instruction bound does not match expected occurrences');
        }
        return {...state, scenario: name, limit: scenarios[name].limit, attempts: 0,
            expected, retired: [], initialMallory: sim.memory.slice(bodies[2].base,
                bodies[2].base + bodies[2].layout.lumpSize)};
    }
    function outcome(state) {
        const {sim, scenario, attempts, limit, bodies, roles} = state;
        if (scenario === 'setup') return 'Setup validated; no workload executed.';
        if (attempts < limit) return `In progress: ${attempts}/${limit} attempts`;
        if (scenario === 'mallory') {
            const fault = sim.faultLog.at(-1);
            if (fault?.type !== 'NO_CAPABILITY' || fault.threadSlot !== bodies[2].slot ||
                fault.pc !== 1 || sim.lastStepEvidence?.outcome !== 'fault' ||
                sim.lastStepEvidence?.instruction?.decoded?.opcode !== 0 ||
                sim.memory[roles[0].base + 9] !== secret)
                throw new Error('Mallory boundary did not match NO_CAPABILITY at LOAD before DREAD');
            return 'PASS: NO_CAPABILITY on Mallory LOAD; DREAD not attempted; Alice secret intact. Stopped at first fault.';
        }
        if (sim.faultLog.length || !sim._liveThreadOwned || sim._currentThreadSlot !== bodies[0].slot ||
            !state.initialMallory.every((word, i) => word === sim.memory[bodies[2].base + i]) ||
            sim.dr[2] !== 303)
            throw new Error('Manager continuation, Thread ownership or dormant Mallory body did not match');
        if (scenario === 'roundtrip') {
            if (sim.dr[1] !== 101 || sim.memory[bodies[1].base + bodies[1].layout.drStart + 1] !== 202)
                throw new Error('Roundtrip private DR1 mismatch');
            return 'PASS: Boot.Thread DR1=101 / DR2=303; Thread.2 private DR1=202.';
        }
        if (sim.memory[roles[0].base + 9] !== secret ||
            sim.memory[bodies[1].base + bodies[1].layout.drStart + 1] !== secret)
            throw new Error('Alice Stash/Reveal result mismatch');
        return 'PASS: Alice Stash/Reveal retired; Thread.2 DR1=0x2a7; manager DR2=303.';
    }
    function step(state) {
        if (state.attempts >= state.limit) return outcome(state);
        const sim = state.sim;
        const owner = sim._currentThreadSlot;
        const pc = sim.pc;
        const result = sim.step();
        const evidence = sim.lastStepEvidence;
        state.attempts++;
        const expected = state.expected[state.attempts - 1];
        const observed = {owner, pc,
            physicalPC: evidence?.instruction?.physicalPC ?? result?.physicalPC,
            opcode: evidence?.instruction?.decoded?.opcode ?? result?.instr?.opcode};
        if (Object.keys(expected).some(key => expected[key] !== observed[key]))
            throw new Error(`Instruction occurrence ${state.attempts} did not match expected owner/executable/PC/opcode`);
        if (result?.instr && evidence?.outcome === 'retired')
            state.retired.push({owner, pc, physicalPC: result.physicalPC,
                opcode: result.instr.opcode, outcome: evidence.outcome});
        else if (!(state.scenario === 'mallory' && state.attempts === state.limit &&
            result === null && evidence?.outcome === 'fault'))
            throw new Error(`Unexpected instruction outcome at attempt ${state.attempts}: ` +
                `${evidence?.outcome || 'no evidence'} ${sim.faultLog.at(-1)?.message || ''}`);
        return outcome(state);
    }
    return {scenarios, createScenario, step, outcome};
});