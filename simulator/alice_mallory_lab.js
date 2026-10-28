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
        alice: {label: 'Alice Stash → Reveal', limit: 18},
        mallory: {label: 'Mallory denied capability', limit: 12},
        'tuple-alice': {label: 'Tuple: Alice owns and reads', limit: 7},
        'tuple-mallory': {label: 'Tuple: Mallory containment', limit: 8},
        'tuple-mallory-own': {label: 'Tuple: Mallory reads own record', limit: 8},
        'tuple-mallory-foreign-read': {label: 'Tuple: Mallory foreign read', limit: 8},
        'tuple-mallory-foreign-write': {label: 'Tuple: Mallory foreign write', limit: 8},
        'tuple-mallory-range-read': {label: 'Tuple: Mallory out-of-range read', limit: 8},
        'tuple-mallory-range-write': {label: 'Tuple: Mallory out-of-range write', limit: 8},
        'ascending-actors': {label: 'Ascending layout: Alice / Mallory in separate Threads', limit: 40},
    });
    function createScenario(name, binaries) {
        if (!Object.prototype.hasOwnProperty.call(scenarios, name)) throw new Error('Unknown lab scenario');
        if (name.startsWith('tuple-')) return tupleLab().createScenario(name, binaries);
        if (name === 'ascending-actors') return ascendingLab().create(binaries);
        const state = fixture.createAliceMalloryThreadFixture(false, binaries);
        const {sim, threadSlots, bodies, roles, nextBase} = state;
        const instruction = (op, dst, src, imm, cond = 14) =>
            sim.encodeInstruction(op, cond, dst, src, imm);
        const iadd = (dst, value) => instruction(21, dst, 0, 0x4000 | value);
        const change = (register, cond = 14) => instruction(4, register, register, 0, cond);
        const load = (register, row) => instruction(0, register, 6, row << 4);
        const managerGT = fixture.threadGT(sim, threadSlots[0]);
        const driver = (slot, offset, code, label, caps = []) =>
            fixture.installThreadDriver(sim, slot, nextBase + offset, code, label, caps);
        let expected = [];
        if (name !== 'setup') {
            let manager, alice, mallory;
            if (name === 'roundtrip') {
                manager = driver(32, 0, [iadd(1, 101), change(2),
                    iadd(2, 303)], 'manager');
                alice = driver(33, 64, [iadd(1, 202), change(2),
                    iadd(2, 404)], 'Alice roundtrip driver');
            } else if (name === 'alice') {
                manager = driver(32, 0, [iadd(1, 101), change(2),
                    iadd(2, 303)], 'manager');
                alice = driver(33, 64, [
                    iadd(2, 202), iadd(1, secret), instruction(2, 1, 0, 1),
                    load(1, 1), iadd(1, 0),
                    instruction(2, 1, 0, 2), instruction(22, 3, 1, 0x4000 | secret),
                    load(2, 2), change(2, 0), iadd(2, 999),
                ], 'Alice methods driver', [roles[0].gt, managerGT]);
            } else {
                manager = driver(32, 0, [iadd(2, 101), change(2),
                    change(3), iadd(2, 999)], 'manager');
                alice = driver(33, 64, [iadd(1, secret), instruction(2, 1, 0, 1),
                    load(2, 1), change(2), iadd(2, 999)], 'Alice Stash driver', [managerGT]);
                mallory = driver(34, 128, [instruction(2, 1, 0, 1),
                    iadd(2, 999)], 'Mallory Steal driver');
            }
            for (const [body, resident] of [[bodies[1], alice], ...(mallory ? [[bodies[2], mallory]] : [])]) {
                fixture.prepareThreadContinuation(sim, body, resident);
            }
            sim.memory[bodies[1].base + bodies[1].layout.capsStart + 2] = managerGT;
            const entry = sim.readNSEntry(manager.slot);
            sim._writeCR(0, manager.gt, entry);
            sim._installLumpHeaderContext(sim.parseGT(manager.gt), manager.slot, entry, manager.header);
            fixture.bindManagerTargets(sim, threadSlots);
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
                        [1, alice, 6, 22], [1, alice, 7, 0], [1, alice, 8, 4], [0, manager, 2, 21]]
                    : [[0, manager, 0, 21], [0, manager, 1, 4],
                        [1, alice, 0, 21], [1, alice, 1, 2],
                        [1, roles[0], 2, 0], [1, roles[0], 3, 17], [1, roles[0], 4, 3],
                        [1, alice, 2, 0], [1, alice, 3, 4], [0, manager, 2, 4],
                        [2, mallory, 0, 2], [2, roles[1], 1, 0]];
            expected = sequence.map(([ownerIndex, resident, pc, opcode]) => ({
                owner: bodies[ownerIndex].slot, pc, physicalPC: resident.base + 1 + pc, opcode,
                slot: resident.slot, raw: sim.memory[resident.base + 1 + pc],
            }));
            if (expected.length !== scenarios[name].limit)
                throw new Error('Scenario instruction bound does not match expected occurrences');
        }
        return {...state, scenario: name, limit: scenarios[name].limit, attempts: 0,
            expected, retired: [], evidence: [], aliceBeforeAttack: null,
            initialMallory: sim.memory.slice(bodies[2].base,
                bodies[2].base + bodies[2].layout.lumpSize)};
    }
    function outcome(state) {
        if (state.scenario.startsWith('tuple-')) return tupleLab().outcome(state);
        if (state.scenario === 'ascending-actors') return ascendingLab().outcome(state);
        const {sim, scenario, attempts, limit, bodies, roles} = state;
        if (scenario === 'setup') return 'Setup validated; no workload executed.';
        if (attempts < limit) return `In progress: ${attempts}/${limit} attempts`;
        const denied = scenario === 'mallory';
        if (state.retired.length !== limit - (denied ? 1 : 0) ||
            state.evidence.length !== limit ||
            state.evidence.some((e, i) => e.outcome !==
                (denied && i === limit - 1 ? 'fault' : 'retired')))
            throw new Error('Missing instruction retirement/fault evidence');
        if (scenario !== 'roundtrip') {
            const writes = state.evidence.filter(e => e.instruction.decoded.opcode === 17);
            if (writes.length !== 1 || !writes[0].effects.some(effect =>
                effect.kind === 'memory-write' && effect.address === roles[0].base + 9 &&
                effect.value === secret && effect.previousValue !== secret))
                throw new Error('Alice Stash lacks an actual private-data write');
        }
        if (scenario === 'mallory') {
            const fault = sim.faultLog.at(-1);
            const evidence = state.evidence.at(-1);
            if (sim.faultLog.length !== 1 || fault?.type !== 'BOUNDS' ||
                fault.threadSlot !== bodies[2].slot ||
                fault.pc !== 1 || sim.lastStepEvidence?.outcome !== 'fault' ||
                sim.lastStepEvidence?.instruction?.decoded?.opcode !== 0 ||
                fault.physicalPC !== roles[1].base + 2 ||
                fault.faultRawWord !== 0x070b0020 ||
                !sim.halted || !sim.bootComplete || sim.pc !== 1 ||
                sim._currentThreadSlot !== bodies[2].slot ||
                evidence.pre.cr[1].word0 !== evidence.post.cr[1].word0 ||
                state.evidence.some(e => e.instruction.decoded.opcode === 16) ||
                !state.aliceBeforeAttack?.every((word, i) => word === sim.memory[roles[0].base + i]) ||
                sim.memory[roles[0].base + 9] !== secret)
                throw new Error('Mallory boundary did not match BOUNDS at LOAD before DREAD');
            return 'PASS: BOUNDS on Mallory LOAD; DREAD not attempted; Alice secret intact. Stopped at first fault.';
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
        const reads = state.evidence.filter(e => e.instruction.decoded.opcode === 16);
        if (reads.length !== 1 || reads[0].pre.dr[1] !== 0 ||
            reads[0].post.dr[1] !== secret || !reads[0].effects.some(effect =>
                effect.kind === 'data-read' && effect.address === roles[0].base + 9 &&
                effect.value === secret))
            throw new Error('Alice Reveal lacks an actual private-data read into cleared DR1');
        return 'PASS: Alice Stash/Reveal retired; Thread.2 DR1=0x2a7; manager DR2=303.';
    }
    function step(state) {
        if (state.scenario.startsWith('tuple-')) return tupleLab().step(state);
        if (state.scenario === 'ascending-actors') {
            if (state.passed || state.attempts >= state.limit || state.sim.halted) return outcome(state);
            return ascendingLab().step(state);
        }
        if (state.attempts >= state.limit) return outcome(state);
        const sim = state.sim;
        if (state.scenario === 'mallory' && state.attempts === state.limit - 2) {
            const role = state.roles[0];
            const header = sim.parseLumpHeader(sim.memory[role.base]);
            state.aliceBeforeAttack = sim.memory.slice(role.base, role.base + header.lumpSize);
        }
        const owner = sim._currentThreadSlot;
        const pc = sim.pc;
        const successful = sim.executionStats.successful;
        const result = sim.step();
        const evidence = sim.lastStepEvidence;
        state.attempts++;
        const expected = state.expected[state.attempts - 1];
        const observed = {owner, pc,
            physicalPC: evidence?.instruction?.physicalPC ?? result?.physicalPC,
            opcode: evidence?.instruction?.decoded?.opcode ?? result?.instr?.opcode,
            slot: evidence?.pre?.artifact?.slot, raw: evidence?.instruction?.raw};
        if (Object.keys(expected).some(key => expected[key] !== observed[key]))
            throw new Error(`Instruction occurrence ${state.attempts} did not match expected owner/executable/PC/opcode`);
        if (result?.instr && evidence?.outcome === 'retired' &&
            sim.executionStats.successful === successful + 1 && !sim.faultLog.length)
            state.retired.push({owner, pc, physicalPC: result.physicalPC,
                opcode: result.instr.opcode, outcome: evidence.outcome});
        else if (!(state.scenario === 'mallory' && state.attempts === state.limit &&
            result === null && evidence?.outcome === 'fault'))
            throw new Error(`Unexpected instruction outcome at attempt ${state.attempts}: ` +
                `${evidence?.outcome || 'no evidence'} ${sim.faultLog.at(-1)?.message || ''}`);
        if (evidence.outcome === 'fault' && sim.executionStats.successful !== successful)
            throw new Error('Denied instruction was counted as a successful retirement');
        state.evidence.push(evidence);
        return outcome(state);
    }
    function tupleLab() {
        return typeof module !== 'undefined' && module.exports
            ? require('./alice_mallory_tuple_lab') : globalThis.AliceMalloryTupleLab;
    }
    function ascendingLab() {
        return typeof module !== 'undefined' && module.exports
            ? require('./alice_mallory_ascending_lab') : globalThis.AliceMalloryAscendingLab;
    }
    return {scenarios, createScenario, step, outcome, savedFixtures: fixture.savedFixtures};
});
