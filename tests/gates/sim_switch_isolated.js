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
const residentHelper = memoryUiSource.match(
    /function _isResidentIORegister\(slot\) \{[\s\S]*?\n\}/);
const policyHelper = memoryUiSource.match(
    /function _nsPrefetchRow\(slot, manifest\) \{[\s\S]*?\n    \}/);

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
check(!!residentHelper && !!policyHelper, 'Namespace resident-I/O helpers are present');
if (residentHelper && policyHelper) {
    const uiContext = vm.createContext({
        globalThis: {
            ChurchArchitectureContracts: { boot: { minimalSlots: { M_BIT_DEV: 13 } } },
        },
    });
    vm.runInContext(`${residentHelper[0]}\n${policyHelper[0]}`, uiContext);
    check(vm.runInContext('_isResidentIORegister(13)', uiContext),
        'M_BIT_DEV is classified as a resident I/O register');
    check(!vm.runInContext('_isResidentIORegister(14)', uiContext),
        'ordinary post-catalog slots remain source-backed');
    check(vm.runInContext('_nsPrefetchRow(13, null)', uiContext)
        .includes('Resident I/O register'),
        'M_BIT_DEV Source cell identifies a resident I/O register');
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
for (const source of ['SWITCH CR12, CR6', 'SWITCH CR12, CR6, #32768',
    'SWITCH CR12, CR15, #0']) {
    check(new ChurchAssembler().assemble(source).errors.length > 0, `malformed SWITCH rejected: ${source}`);
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

// Every failure is non-mutating, including rejection after the delegated LOAD
// has begun to modify architectural stores.
for (const [setup, expectedFault] of [
    [sim => ({ crDst: 11, crSrc: 1, imm: 0 }), 'INVALID_OP'],
    [sim => ({ crDst: 12, crSrc: 12, imm: 0 }), 'INVALID_OP'],
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

// Real boot reaches the existing Navana.Init dispatch in _bootStep. Init uses
// its private device capabilities to arm CapabilityTest's first isolated load
// only: CR12 is set while CR13–CR15 are explicitly cleared.
const bootRegistry = new AbstractionRegistry();
const bootSystem = new SystemAbstractions(bootRegistry);
const bootDevices = new DeviceAbstractions(bootRegistry);
const bootSim = new ChurchSimulator();
bootSim.initAbstractions(bootRegistry, bootSystem, bootDevices);
for (let guard = 0; guard < 32 && !bootSim.bootComplete && !bootSim.halted; guard++) {
    bootSim._bootStep();
}
check(bootSim.bootComplete && !bootSim.halted, 'normal boot completes through real Navana.Init');
check(bootSim.cr.slice(12, 16).map(cr => cr.m).join(',') === '1,0,0,0',
    'Navana.Init arms only CR12.M');

// CapabilityTest uses the active Thread c-list. Its canonical row 0 SelfTest
// token is at the boot Thread c-list base (word 244), and CR6 must carry L.
bootSim.cr[6] = {
    word0: bootSim.createGT(0, 1, { L: 1 }, 1),
    word1: 244, word2: 0, word3: 0, m: 1
};
const capAssembler = new ChurchAssembler();
const firstSwitch = bootSim.decodeInstruction(
    capAssembler.assemble('SWITCH CR12, CR6, #0').words[0]);
const firstResult = bootSim._execSwitch(firstSwitch);
check(!!firstResult, 'CapabilityTest first SWITCH succeeds after Navana.Init');
check(bootSim.cr[12].m === 0, 'CapabilityTest first SWITCH consumes CR12.M');

const secondSwitch = bootSim.decodeInstruction(
    capAssembler.assemble('SWITCH CR13, CR6, #0').words[0]);
const beforeSecond = state(bootSim);
check(bootSim._execSwitch(secondSwitch) === null, 'CapabilityTest second SWITCH faults with CR13.M absent');
check(state(bootSim) === beforeSecond,
    'CR13 M-absent failure leaves complete CR/M/Namespace/memory state unchanged');

if (failures) process.exitCode = 1;
else console.log('PASS: Task #3193 isolated SWITCH regressions');