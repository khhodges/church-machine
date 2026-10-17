'use strict';
// Isolated, instruction-driven evidence. Allocation is explicit fixture setup,
// not an ISA instruction and not a new authority mechanism.
(function(root, factory) {
    if (typeof module !== 'undefined' && module.exports)
        module.exports = factory(require('./test_alice_mallory_thread_setup'), require('./thread-heap-record'));
    else root.AliceMalloryTupleLab = factory(root.AliceMalloryThreadFixture, root.ThreadHeapRecord);
})(globalThis, function(fixture, records) {
    const secret = 679;
    // Pin the baseline regression artifacts, not mutable latest editor revisions.
    const savedFixtures = {'ide.Alice':'ide.Alice.1.1eec355e.lump', 'ide.Mallory':'ide.Mallory.1.0ca567b5.lump'};
    function createScenario(name, binaries) {
        if (!binaries && typeof module !== 'undefined' && module.exports) {
            const fs = require('fs'), path = require('path');
            binaries = Object.fromEntries(Object.entries(savedFixtures).map(([role, filename]) => {
                const raw = fs.readFileSync(path.join(__dirname, '../server/lumps', filename));
                return [role, Array.from({length:raw.length / 4}, (_,i) => raw.readUInt32BE(i*4))];
            }));
        }
        const state = fixture.createAliceMalloryThreadFixture(false, binaries);
        const {sim, bodies, threadSlots, nextBase} = state;
        const attack = name === 'tuple-mallory';
        const op = (code, dst, src, imm) => sim.encodeInstruction(code, 14, dst, src, imm);
        const add = (dst, value) => op(21, dst, 0, 0x4000 | value);
        const change = register => op(4, register, register, 0);
        const threadGT = slot => sim.createGT(sim.parseNSWord1(sim.readNSEntry(slot).word1_limit).gtSeq,
            slot, {}, 1);
        const manager = fixture.installThreadDriver(sim, 32, nextBase,
            [add(2, 101), change(2),
                attack ? change(3) : add(2, 303)], 'tuple manager');
        const alice = fixture.installThreadDriver(sim, 33, nextBase + 64,
            [add(1, secret), op(17, 1, 5, 0x4005), op(16, 3, 5, 0x4005),
                change(2)], 'Alice tuple owner');
        const mallory = fixture.installThreadDriver(sim, 34, nextBase + 128,
            [op(16, 4, 4, 0x4005)], 'Mallory tuple attempt');
        for (const [body, driver] of [[bodies[1], alice], [bodies[2], mallory]]) {
            sim.memory[body.base + body.layout.capsStart] = driver.gt;
            sim.memory[body.base + body.layout.capsStart + 4] = 0;
            if (body === bodies[1])
                sim.memory[body.base + body.layout.capsStart + 2] = threadGT(threadSlots[0]);
            if (!sim._formatThreadRootSentinel(body.base, body.layout, driver.gt, {image:true}))
                throw new Error('Tuple driver root preparation failed');
            const sto = body.layout.stackEnd - 2;
            sim.memory[body.base + sto - 1] = driver.gt;
            sim.memory[body.base + sto] = sim._packFrameWord(0, 1, sto);
            sim.memory[body.base + 17] = (1 << 12) | (sto - 2);
        }
        // Mallory's fixture driver declares SELF only: no Alice heap capability.
        if (mallory.header.cc !== 1) throw new Error('Mallory unexpectedly has a declared grant');
        const entry = sim.readNSEntry(manager.slot);
        sim._writeCR(0, manager.gt, entry);
        sim._installLumpHeaderContext(sim.parseGT(manager.gt), manager.slot, entry, manager.header);
        for (const [register, slot] of [[2, threadSlots[1]], [3, threadSlots[2]]]) {
            const target = sim.readNSEntry(slot);
            sim.cr[register] = {word0:threadGT(slot), word1:target.word0_location,
                word2:target.word1_limit, word3:0, m:0};
        }
        sim.pc = 0;
        const sequence = [[0,manager,0,21], [0,manager,1,4], [1,alice,0,21],
            [1,alice,1,17], [1,alice,2,16], [1,alice,3,4],
            [0,manager,2,attack ? 4 : 21]];
        if (attack) sequence.push([2,mallory,0,16]);
        return {...state, scenario:name, attack, attempts:0, limit:sequence.length,
            expected:sequence.map(([owner,r,pc,opcode]) =>
                ({owner:bodies[owner].slot, pc, opcode, physicalPC:r.base+1+pc})),
            retired:[], tupleAddress:null, tupleBeforeAttack:null};
    }
    function outcome(s) {
        if (s.attempts < s.limit) return `In progress: ${s.attempts}/${s.limit} attempts`;
        const {sim, bodies} = s;
        const words = sim.memory.slice(s.tupleAddress, s.tupleAddress + records.schema.words);
        const record = records.decode(words);
        if (record.conditions !== secret ||
            sim.memory[bodies[1].base + bodies[1].layout.drStart + 3] !== secret)
            throw new Error('Alice tuple write/read evidence did not match');
        if (s.attack) {
            const fault = sim.faultLog.at(-1);
            if (sim.faultLog.length !== 1 || fault.type !== 'NULL_CAP' ||
                fault.threadSlot !== bodies[2].slot ||
                sim.lastStepEvidence?.outcome !== 'fault' ||
                sim.lastStepEvidence?.instruction?.decoded?.opcode !== 16 ||
                sim.dr[4] !== s.malloryDestinationBefore ||
                !s.tupleBeforeAttack.every((v,i) => v === words[i]) ||
                s.retired.length !== s.limit - 1)
                throw new Error('Containment evidence failed: expected denied DREAD and unchanged complete tuple');
            return 'PASS: Alice wrote and read her tuple through CR5. Mallory has no Alice heap grant: DREAD through empty CR4 faults NULL_CAP without retiring. All 58 Alice tuple words unchanged. Simulator evidence only.';
        }
        if (sim.faultLog.length || sim._currentThreadSlot !== bodies[0].slot || sim.dr[2] !== 303)
            throw new Error('Alice did not return cleanly to the manager');
        return 'PASS: Alice DWRITE/DREAD through her own CR5 returned 679; complete tuple decoded; manager resumed. Simulator evidence only.';
    }
    function step(s) {
        if (s.attempts >= s.limit) return outcome(s);
        const {sim} = s;
        // After the real CHANGE enters Alice, explicitly reserve fixture storage.
        if (s.attempts === 2) {
            records.reservePool(sim, 0, records.schema.words);
            records.allocate(sim, 0);
            records.importRecord(sim, 0, {...records.sample(), callerName:'Alice synthetic', conditions:0});
            s.tupleAddress = records.validateTarget(sim, 0).address;
        }
        if (s.attempts === 6)
            s.tupleBeforeAttack = sim.memory.slice(s.tupleAddress, s.tupleAddress + records.schema.words);
        if (s.attack && s.attempts === 7) {
            if (sim.cr[4].word0 !== 0 ||
                sim.cr.slice(0, 12).some(cap => cap.word0 && sim.parseGT(cap.word0).index === s.bodies[1].slot))
                throw new Error('Mallory fixture unexpectedly holds Alice Thread authority');
            s.malloryDestinationBefore = sim.dr[4];
        }
        const owner = sim._currentThreadSlot, pc = sim.pc;
        sim.step();
        const evidence = sim.lastStepEvidence;
        const observed = {owner, pc, opcode:evidence?.instruction?.decoded?.opcode,
            physicalPC:evidence?.instruction?.physicalPC};
        const expected = s.expected[s.attempts++];
        if (Object.keys(expected).some(key => expected[key] !== observed[key]))
            throw new Error('Tuple test instruction identity mismatch');
        const denied = s.attack && s.attempts === s.limit;
        if (evidence?.outcome !== (denied ? 'fault' : 'retired'))
            throw new Error('Unexpected tuple test instruction outcome');
        if (!denied) s.retired.push({...observed, outcome:'retired'});
        return outcome(s);
    }
    return {createScenario, step, outcome, savedFixtures};
});
