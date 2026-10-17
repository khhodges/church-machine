'use strict';
// Isolated, instruction-driven evidence. Allocation is explicit fixture setup,
// not an ISA instruction and not a new authority mechanism.
(function(root, factory) {
    if (typeof module !== 'undefined' && module.exports)
        module.exports = factory(require('./test_alice_mallory_thread_setup'), require('./thread-heap-record'));
    else root.AliceMalloryTupleLab = factory(root.AliceMalloryThreadFixture, root.ThreadHeapRecord);
})(globalThis, function(fixture, records) {
    const secret = 679;
    const malloryValue = 913;
    const destinationSentinel = 0x13579bdf;
    const cases = Object.freeze({
        'tuple-alice': {kind:'alice'},
        'tuple-mallory': {kind:'absent', opcode:16, cr:4, fault:'NULL_CAP'},
        'tuple-mallory-own': {kind:'own', opcode:16, cr:5},
        'tuple-mallory-foreign-read': {kind:'foreign', opcode:16, cr:5, fault:'RANGE'},
        'tuple-mallory-foreign-write': {kind:'foreign', opcode:17, cr:5, fault:'RANGE'},
        'tuple-mallory-range-read': {kind:'range', opcode:16, cr:5, fault:'RANGE'},
        'tuple-mallory-range-write': {kind:'range', opcode:17, cr:5, fault:'RANGE'},
    });
    // Pin the baseline regression artifacts, not mutable latest editor revisions.
    const savedFixtures = {'ide.Alice':'ide.Alice.1.1eec355e.lump', 'ide.Mallory':'ide.Mallory.1.0ca567b5.lump'};
    function createScenario(name, binaries) {
        if (!Object.prototype.hasOwnProperty.call(cases, name)) throw new Error('Unknown tuple scenario');
        const test = cases[name];
        if (!binaries && typeof module !== 'undefined' && module.exports) {
            const fs = require('fs'), path = require('path');
            binaries = Object.fromEntries(Object.entries(savedFixtures).map(([role, filename]) => {
                const raw = fs.readFileSync(path.join(__dirname, '../server/lumps', filename));
                return [role, Array.from({length:raw.length / 4}, (_,i) => raw.readUInt32BE(i*4))];
            }));
        }
        const state = fixture.createAliceMalloryThreadFixture(false, binaries);
        const {sim, bodies, threadSlots, nextBase} = state;
        const visitMallory = test.kind !== 'alice';
        const attack = !!test.fault;
        const aliceHeap = bodies[1].base + bodies[1].layout.heapStart;
        const malloryHeap = bodies[2].base + bodies[2].layout.heapStart;
        const malloryEntry = sim.readNSEntry(bodies[2].slot);
        const rangeBase = malloryEntry.word0_location;
        const rangeEnd = rangeBase + sim.parseNSWord1(malloryEntry.word1_limit).limit;
        // Indexed unsigned displacement deliberately wraps the address back to
        // Alice. Only the ordinary CR5 range gate may reject this attempt.
        const offset = test.kind === 'foreign' ? (aliceHeap + 5 - malloryHeap) >>> 0
            : test.kind === 'range' ? rangeEnd + 1 - malloryHeap : 5;
        const immediate = test.kind === 'foreign' ? 7 : 0x4000 | offset;
        const op = (code, dst, src, imm) => sim.encodeInstruction(code, 14, dst, src, imm);
        const add = (dst, value) => op(21, dst, 0, 0x4000 | value);
        const change = register => op(4, register, register, 0);
        const threadGT = slot => sim.createGT(sim.parseNSWord1(sim.readNSEntry(slot).word1_limit).gtSeq,
            slot, {}, 1);
        const manager = fixture.installThreadDriver(sim, 32, nextBase,
            [add(2, 101), change(2),
                visitMallory ? change(3) : add(2, 303)], 'tuple manager');
        const alice = fixture.installThreadDriver(sim, 33, nextBase + 64,
            [add(1, secret), op(17, 1, 5, 0x4005), op(16, 3, 5, 0x4005),
                change(2)], 'Alice tuple owner');
        const mallory = fixture.installThreadDriver(sim, 34, nextBase + 128,
            [op(test.opcode || 16, 4, test.cr || 4, immediate)], 'Mallory tuple attempt');
        sim.memory[bodies[2].base + bodies[2].layout.drStart + 4] = destinationSentinel;
        sim.memory[bodies[2].base + bodies[2].layout.drStart + 7] = offset;
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
            [0,manager,2,visitMallory ? 4 : 21]];
        if (visitMallory) sequence.push([2,mallory,0,test.opcode]);
        const mnemonic = test.opcode === 17 ? 'DWRITE' : 'DREAD';
        const targetAddress = (malloryHeap + offset) >>> 0;
        const expectedReason = test.kind === 'absent' ? 'DREAD: CR4 is NULL'
            : `${mnemonic}: CR5: address ${targetAddress} outside valid range [${rangeBase}..${rangeEnd}]`;
        return {...state, scenario:name, test, attack, visitMallory, offset, targetAddress,
            expectedReason, malloryInstruction:sim.memory[mallory.base + 1],
            attempts:0, limit:sequence.length,
            expected:sequence.map(([owner,r,pc,opcode]) =>
                ({owner:bodies[owner].slot, pc, opcode, physicalPC:r.base+1+pc})),
            retired:[], tupleAddress:null, tupleBeforeAttack:null, malloryTupleAddress:null,
            firstFaultEvidence:null};
    }
    function outcome(s) {
        if (s.attempts < s.limit) return `In progress: ${s.attempts}/${s.limit} attempts`;
        const {sim, bodies} = s;
        const words = sim.memory.slice(s.tupleAddress, s.tupleAddress + records.schema.words);
        const record = records.decode(words);
        if (record.conditions !== secret ||
            sim.memory[bodies[1].base + bodies[1].layout.drStart + 3] !== secret)
            throw new Error('Alice tuple write/read evidence did not match');
        if (s.visitMallory && !s.tupleBeforeAttack.every((v,i) => v === words[i]))
            throw new Error('Alice complete tuple changed');
        if (s.attack) {
            const fault = sim.faultLog[0], evidence = s.firstFaultEvidence;
            const expected = s.expected.at(-1);
            if (sim.faultLog.length !== 1 || fault.type !== s.test.fault ||
                fault.rawDiagnosticReason !== s.expectedReason ||
                fault.threadSlot !== bodies[2].slot ||
                fault.pc !== expected.pc || fault.physicalPC !== expected.physicalPC ||
                fault.faultRawWord !== s.malloryInstruction ||
                fault.faultingAbstractionSlot !== 34 ||
                evidence !== sim.lastStepEvidence || evidence?.outcome !== 'fault' ||
                evidence.fault?.type !== s.test.fault || evidence.fault?.message !== s.expectedReason ||
                evidence.occurrenceId !== fault.executionOccurrence ||
                evidence.instruction?.raw !== s.malloryInstruction ||
                evidence.instruction?.physicalPC !== expected.physicalPC ||
                evidence.pre.pc !== expected.pc || evidence.pre.artifact.slot !== 34 ||
                evidence.instruction?.decoded?.opcode !== s.test.opcode ||
                evidence.instruction?.decoded?.crSrc !== s.test.cr ||
                evidence.instruction?.decoded?.crDst !== 4 ||
                evidence.effects.length !== 0 ||
                !s.malloryRegistersBefore.every((v,i) => v === sim.dr[i] &&
                    v === evidence.pre.dr[i] && v === evidence.post.dr[i] && v === fault.drSnapshot[i] &&
                    v === sim.memory[bodies[2].base + bodies[2].layout.drStart + i]) ||
                s.retired.length !== s.limit - 1)
                throw new Error('Containment evidence failed: exact first fault or unchanged registers did not match');
            const access = s.test.kind === 'absent' ? 'empty CR4' :
                `valid own CR5 (${s.test.kind === 'foreign' ? 'indexed offset targeting Alice' : 'one-past-Thread offset'})`;
            return `PASS: Mallory ${s.test.opcode === 17 ? 'DWRITE' : 'DREAD'} through ${access} faults ${s.test.fault} without retiring. All data registers and all 58 Alice tuple words unchanged. Simulator evidence only.`;
        }
        if (s.visitMallory) {
            const evidence = sim.lastStepEvidence;
            if (sim.faultLog.length || sim._currentThreadSlot !== bodies[2].slot ||
                sim.dr[4] !== malloryValue || evidence?.outcome !== 'retired' ||
                evidence.effects.filter(e => e.kind === 'data-read' &&
                    e.address === s.malloryTupleAddress + 5 && e.capability === 5 &&
                    e.value === malloryValue).length !== 1 ||
                s.retired.length !== s.limit)
                throw new Error('Mallory own tuple read evidence failed');
            return 'PASS: Mallory DREAD through valid own CR5 at offset 5 reads her own tuple (913), not Alice’s (679). All 58 Alice tuple words unchanged. Simulator evidence only.';
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
        if (s.visitMallory && s.attempts === 7) {
            if (sim.cr[4].word0 !== 0 ||
                sim.cr.slice(0, 12).some(cap => cap.word0 && sim.parseGT(cap.word0).index === s.bodies[1].slot))
                throw new Error('Mallory fixture unexpectedly holds Alice Thread authority');
            records.reservePool(sim, 0, records.schema.words);
            records.allocate(sim, 0);
            records.importRecord(sim, 0, {...records.sample(), callerName:'Mallory synthetic', conditions:malloryValue});
            s.malloryTupleAddress = records.validateTarget(sim, 0).address;
            if (sim.parseGT(sim.cr[5].word0).index !== s.bodies[2].slot ||
                !sim.mLoad(sim.cr[5].word0, 'R', 5, s.malloryTupleAddress + 5).ok ||
                !sim.mLoad(sim.cr[5].word0, 'W', 5, s.malloryTupleAddress + 5).ok)
                throw new Error('Mallory must have valid own read/write CR5 authority');
            s.malloryRegistersBefore = Array.from(sim.dr);
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
        if (denied) s.firstFaultEvidence = evidence;
        if (!denied) s.retired.push({...observed, outcome:'retired'});
        return outcome(s);
    }
    return {createScenario, step, outcome, savedFixtures, cases};
});
