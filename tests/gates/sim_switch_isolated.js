'use strict';

// Focused Task #3193 simulator/assembler regression suite.  This deliberately
// exercises SWITCH without boot fixtures so authorization and no-mutation
// guarantees stay local and deterministic.
global.window = { bootConfig: {} };
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ChurchAssembler = require('../../simulator/assembler.js');
const ChurchSimulator = require('../../simulator/simulator.js');
const AbstractionRegistry = require('../../simulator/abstractions.js');
const SystemAbstractions = require('../../simulator/system_abstractions.js');
const DeviceAbstractions = require('../../simulator/device_abstractions.js');

const memoryUiSource = fs.readFileSync(
    path.resolve(__dirname, '../../simulator/app-memory.js'), 'utf8');
const architectureSlotsHelper = memoryUiSource.match(
    /function _architectureBootSlots\(\) \{[\s\S]*?\n\}/);
const residentHelper = memoryUiSource.match(
    /function _isResidentIORegister\(slot, label\) \{[\s\S]*?\n\}/);

let failures = 0;
function check(condition, message) {
    if (!condition) {
        failures++;
        console.error(`FAIL: ${message}`);
    }
}
function machine() {
    const sim = new ChurchSimulator();
    sim.pc = 19;
    sim.cr[1] = { word0: 0x42000001, word1: 1, word2: 2, word3: 3, m: 1 };
    sim.cr[6] = { word0: sim.createGT(0, 0, { L: 1 }, 1), word1: 0, word2: 0, word3: 0, m: 0 };
    return sim;
}
function state(sim) {
    return JSON.stringify({
        cr: sim.cr, memory: Array.from(sim.memory), nsCount: sim.nsCount,
        labels: sim.nsLabels
    });
}

// Slot 13 is a fixed resident MMIO register, not a source-backed LUMP.
check(!!architectureSlotsHelper && !!residentHelper, 'Namespace resident-I/O helpers are present');
if (architectureSlotsHelper && residentHelper) {
    const uiContext = vm.createContext({
        globalThis: {
            ChurchArchitectureContracts: { boot: { minimalSlots: { M_BIT_DEV: 13 } } },
        },
    });
    vm.runInContext(`${architectureSlotsHelper[0]}\n${residentHelper[0]}`, uiContext);
    check(vm.runInContext("_isResidentIORegister(13, 'M_BIT_DEV')", uiContext),
        'M_BIT_DEV is classified as a resident I/O register');
    check(!vm.runInContext("_isResidentIORegister(14, 'ordinary')", uiContext),
        'ordinary post-catalog slots remain source-backed');
}

// Full four-bit destination encoding must survive a disassembly round trip.
for (const dst of [12, 13, 14, 15]) {
    const asm = new ChurchAssembler();
    const encoded = asm.assemble(`SWITCH CR${dst}, CR6, #32767`);
    check(encoded.errors.length === 0, `CR${dst} encoding is accepted`);
    const word = encoded.words[0] >>> 0;
    check(((word >>> 19) & 0xF) === dst, `CR${dst} is not truncated`);
    const again = asm.assemble(asm.disassemble(word));
    check(again.errors.length === 0 && again.words[0] === word, `CR${dst} round trips exactly`);
}
for (const dst of Array.from({ length: 12 }, (_, i) => i)) {
    check(new ChurchAssembler().assemble(`SWITCH CR${dst}, CR6, #0`).errors.length > 0,
        `CR${dst} destination is rejected`);
}
for (const source of ['SWITCH CR12, CR6', 'SWITCH CR12, CR13',
    'SWITCH CR12, CR6, #32768',
    'SWITCH CR12, CR15, #0']) {
    check(new ChurchAssembler().assemble(source).errors.length > 0, `malformed SWITCH rejected: ${source}`);
}

// The exact CR15/CR15 encoding is the guarded Boot placeholder.
{
    const asm = new ChurchAssembler();
    const encoded = asm.assemble('SWITCH CR15, CR15');
    check(encoded.errors.length === 0, 'guarded Boot SWITCH syntax is accepted');
    const word = encoded.words[0] >>> 0;
    check(((word >>> 19) & 0xF) === 15 && ((word >>> 15) & 0xF) === 15,
        'guarded Boot SWITCH encodes matching CR15 fields');
    check(asm.disassemble(word).trim() === 'SWITCH  CR15, CR15',
        'guarded Boot SWITCH disassembles without a synthetic row');
}

// Destination M is sampled before LOAD, source M is irrelevant, and success
// consumes destination M just as the hardware isolated register bank does.
for (const dst of [12, 13, 14, 15]) {
    const sim = machine();
    sim.cr[dst].m = 1;
    sim._execLoad = d => {
        sim.cr[d.crDst] = { word0: 0x43000002, word1: 10, word2: 11, word3: 12, m: 1 };
        sim.pc++;
        return { pc: sim.pc - 1, instr: d, desc: 'load' };
    };
    const result = sim._execSwitch({ crDst: dst, crSrc: 1, imm: 0 });
    check(!!result && sim.cr[dst].m === 0, `CR${dst} M authorizes then is consumed`);
    check(sim.cr[1].m === 1, `CR${dst} SWITCH ignores source M`);
}

{
    const sim = machine();
    sim.cr[15] = { word0: 0xDEADBEEF, word1: 1, word2: 2, word3: 3, m: 0 };
    const before = { ...sim.cr[15] };
    const beforePc = sim.pc;
    const result = sim._execSwitch({ crDst: 15, crSrc: 15, imm: 0 });
    check(!!result && sim.pc === beforePc + 1, 'guarded Boot SWITCH advances execution');
    check(JSON.stringify(sim.cr[15]) === JSON.stringify(before),
        'guarded Boot SWITCH is an atomic no-op without a fabricated GT');
}

// Every failure is non-mutating, including rejection after the delegated LOAD
// has begun to modify architectural stores.
for (const [setup, expectedFault] of [
    [sim => ({ crDst: 11, crSrc: 1, imm: 0 }), 'INVALID_OP'],
    [sim => ({ crDst: 12, crSrc: 13, imm: 0 }), 'INVALID_OP'],
    [sim => ({ crDst: 12, crSrc: 1, imm: 0 }), 'PERM_L'],
    [sim => { sim.cr[12].m = 1; sim.cr[6].word0 = sim.createGT(0, 0, { E: 1 }, 1); return { crDst: 12, crSrc: 6, imm: 0 }; }, 'PERM_L'],
    [sim => {
        sim.cr[12].m = 1;
        sim._execLoad = () => { sim.cr[12].word0 = 99; sim.memory[23] = 88; return null; };
        return { crDst: 12, crSrc: 1, imm: 0 };
    }, null],
]) {
    const sim = machine();
    const instruction = setup(sim);
    const before = state(sim);
    let actualFault = null;
    const originalFault = sim.fault.bind(sim);
    sim.fault = (type, message) => {
        actualFault = type;
        return originalFault(type, message);
    };
    check(sim._execSwitch(instruction) === null, 'invalid SWITCH faults');
    if (expectedFault) {
        check(actualFault === expectedFault,
            `invalid SWITCH reports ${expectedFault}, got ${actualFault}`);
    }
    check(state(sim) === before, 'failed SWITCH leaves CR/M/NS/memory unchanged');
}

// The M-bit device is one Namespace-owned 32-bit I/O object. Bits 0..15 map
// directly to CR0.M..CR15.M.
const namespace = { name: 'Navana' };
const device = new DeviceAbstractions({ abstractions: { 5: namespace }, bindMethod() {} });
const deviceSim = { cr: Array.from({ length: 16 }, () => ({ m: 0 })) };
const cap = device.issueNamespaceMBitCapability(namespace);
check(!!cap && cap.words === 1, 'Namespace receives one single-word M capability');
check(device.writeMBitWord(deviceSim, cap, 0xA55A, namespace).ok, 'exact Namespace M capability works');
check(deviceSim.cr.every((cr, n) => cr.m === ((0xA55A >>> n) & 1)),
    'low 16 bits map directly to CR0.M through CR15.M');
for (const [candidate, value, owner] of [
    [{ ...cap }, 0, namespace],
    [cap, 0, { name: 'ordinary' }],
    [Object.freeze({ ...cap, rights: 'W' }), 0, namespace],
    [Object.freeze({ ...cap, port: 0xFFFFFF1D }), 0, namespace],
    [cap, -1, namespace],
]) {
    const before = deviceSim.cr.map(cr => cr.m).join(',');
    check(!device.writeMBitWord(deviceSim, candidate, value, owner).ok, 'invalid M device access fails closed');
    check(deviceSim.cr.map(cr => cr.m).join(',') === before, 'invalid M device access does not mutate M');
}

// Real boot reaches the existing Navana.Init dispatch in _bootStep.
const bootRegistry = new AbstractionRegistry();
const bootSystem = new SystemAbstractions(bootRegistry);
const bootDevices = new DeviceAbstractions(bootRegistry);
const bootSim = new ChurchSimulator();
bootSim.initAbstractions(bootRegistry, bootSystem, bootDevices);
for (let guard = 0; guard < 32 && !bootSim.bootComplete && !bootSim.halted; guard++) {
    bootSim._bootStep();
}
check(bootSim.bootComplete && !bootSim.halted, 'normal boot completes through real Navana.Init');

// CapabilityTest explicitly writes the recovered CR12 mask through M_BIT_DEV,
// then SWITCH consumes it. It does not rely on boot-time M state.
const bootNamespace = { name: 'Navana' };
const capabilityMBitDevice = new DeviceAbstractions({
    abstractions: { 5: bootNamespace }, bindMethod() {}
});
const bootMBitCap = capabilityMBitDevice.issueNamespaceMBitCapability(bootNamespace);
const sequenceSim = machine();
sequenceSim._execLoad = d => {
    sequenceSim.cr[d.crDst] = {
        word0: 0x4A000006, word1: 1, word2: 2, word3: 3, m: 1
    };
    sequenceSim.pc++;
    return { pc: sequenceSim.pc - 1, instr: d, desc: 'load' };
};
check(capabilityMBitDevice.writeMBitWord(sequenceSim, bootMBitCap, 0x1000, bootNamespace).ok,
    'CapabilityTest writes the CR12 M-bit mask');
const capAssembler = new ChurchAssembler();
const firstSwitch = sequenceSim.decodeInstruction(
    capAssembler.assemble('SWITCH CR12, CR6, #0').words[0]);
const firstResult = sequenceSim._execSwitch(firstSwitch);
check(!!firstResult, 'CapabilityTest first SWITCH succeeds after its M_BIT_DEV write');
check(sequenceSim.cr[12].m === 0, 'CapabilityTest first SWITCH consumes CR12.M');

check(capabilityMBitDevice.writeMBitWord(sequenceSim, bootMBitCap, 0x8000, bootNamespace).ok,
    'CapabilityTest writes the CR15 M-bit mask');
const secondSwitch = sequenceSim.decodeInstruction(
    capAssembler.assemble('SWITCH CR15, CR15').words[0]);
check(!!sequenceSim._execSwitch(secondSwitch), 'CapabilityTest guarded CR15 SWITCH succeeds');
check(sequenceSim.cr[15].m === 0, 'guarded CR15 self-switch consumes its M bit');

if (failures) process.exitCode = 1;
else console.log('PASS: Task #3193 isolated SWITCH regressions');