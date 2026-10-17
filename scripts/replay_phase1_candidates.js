'use strict';
// The existing explicit ascending-image core; never the legacy boot generator.
const fs = require('node:fs');
const Simulator = require('../simulator/simulator');

function replay(bytes, maxSteps = 6000) {
    const sim = Simulator.fromAscendingNamespaceImage(bytes, {
        word0: 0x02000001, word1: 0, word2: 1023, word3: 0, m: 1,
    });
    const slots = {}, faults = [], transitions = [], tail = [], io = [];
    const selfTest = {returns: [], guardsPassed: 0, failedGuards: []};
    const count = (slot, key) => {
        slots[slot] ||= {};
        slots[slot][key] = (slots[slot][key] || 0) + 1;
    };
    const snapshot = () => ({
        thread: sim.cr[12].word0 & 65535, code: sim.cr[14].word0 & 65535,
        pc: sim.pc, cr6: {...sim.cr[6]}, cr15: {...sim.cr[15]}, dr1: sim.dr[1],
    });
    const mLoad = sim.mLoad.bind(sim);
    sim.mLoad = (...args) => {
        const result = mLoad(...args);
        if (result.ok) count(result.index, 'validatedAccesses');
        return result;
    };
    const fault = sim.fault.bind(sim);
    sim.fault = (type, message, meta) => {
        faults.push({type, message, before: snapshot()});
        return fault(type, message, meta);
    };
    // Observe, never replace device semantics or suppress a fault.
    for (const [method, kind] of [['_execDread', 'read'], ['_execDwrite', 'write']]) {
        const execute = sim[method].bind(sim);
        sim[method] = d => {
            const slot = sim.cr[d.crSrc].word0 & 65535;
            const before = snapshot(), result = execute(d);
            if (result) {
                count(slot, kind === 'read' ? 'dataReads' : 'dataWrites');
                io.push({kind, slot, instruction: before, value: sim.dr[d.crDst] >>> 0,
                    description: result.desc});
            }
            return result;
        };
    }
    const selfBase = sim.readNSEntry(6).word0_location;
    const selfCW = (sim.memory[selfBase] >>> 10) & 8191;
    const guards = new Map();
    for (let word = 2; word < selfCW; word++) {
        const statusWrite = sim.memory[selfBase + word];
        if ((statusWrite >>> 15) === (0xaf084000 >>> 15) &&
                (statusWrite & 0x4000) && (statusWrite & 0x3fff) &&
                sim.memory[selfBase + word + 1] === 0x1f000000 &&
                sim.memory[selfBase + word - 1] >>> 27 === 23) {
            guards.set(word - 2, statusWrite & 0x3fff);
        }
    }
    selfTest.distinctGuards = guards.size;
    const started = !!sim.startEntryThread();
    let steps = 0;
    while (started && !sim.halted && !faults.length && steps < maxSteps) {
        const before = snapshot();
        const word = sim.memory[sim.cr[14].word1 + 1 + sim.pc] >>> 0;
        const result = sim.step();
        const after = snapshot();
        steps++;
        count(before.code, result ? 'retired' : 'attempted');
        count(before.thread, 'threadSteps');
        const event = {step: steps, before, word: word.toString(16).padStart(8, '0'),
            after, description: result?.desc || null};
        tail.push(event);
        if (tail.length > 8) tail.shift();
        if (before.thread !== after.thread || before.code !== after.code) transitions.push(event);
        if (before.code === 6 && guards.has(before.pc)) {
            if (result && !result.skipped) selfTest.guardsPassed++;
            else selfTest.failedGuards.push({step: steps, pc: before.pc, status: guards.get(before.pc)});
        }
        if (before.code === 6 && after.code === 10 && result?.instr?.opcode === 3) {
            selfTest.returns.push({step: steps, thread: before.thread, status: before.dr1});
        }
        if (!result) break;
    }
    return {started, steps, maxSteps, slots, faults, transitions, tail, io, selfTest,
        final: snapshot(), halted: sim.halted,
        ledBits: sim.ledBits, uart: Array.from(sim.uartRegs), timer: Array.from(sim.timerRegs),
        stopped: faults.length ? 'fault' : sim.halted ? 'halt' : 'step-budget'};
}
if (require.main === module) {
    console.log(JSON.stringify(replay(fs.readFileSync(process.argv[2])), null, 2));
}
module.exports = {replay};
