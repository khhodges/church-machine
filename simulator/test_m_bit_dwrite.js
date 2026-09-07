'use strict';

global.window = { bootConfig: {} };
const ChurchAssembler = require('./assembler.js');
const ChurchSimulator = require('./simulator.js');
const AbstractionRegistry = require('./abstractions.js');
const SystemAbstractions = require('./system_abstractions.js');
const DeviceAbstractions = require('./device_abstractions.js');

let failed = 0;
function check(label, condition) {
    if (condition) console.log('PASS ' + label);
    else { console.error('FAIL ' + label); failed++; }
}

const registry = new AbstractionRegistry();
const system = new SystemAbstractions(registry);
const devices = new DeviceAbstractions(registry);
const sim = new ChurchSimulator();
sim.initAbstractions(registry, system, devices);
for (let guard = 0; guard < 32 && !sim.bootComplete && !sim.halted; guard++) {
    sim._bootStep();
}

const entry = sim.readNSEntry(13);
sim.cr[0] = {
    word0: sim.createGT(entry.gtSeq || 0, 13, { W: 1 }, 1),
    word1: entry.word0_location,
    word2: entry.word1_limit,
    word3: entry.word2_seals,
    m: 0
};
sim.dr[1] = 0x1000;

const assembler = new ChurchAssembler();
const assembled = assembler.assemble('DWRITE DR1, CR0, #0');
const decoded = sim.decodeInstruction(assembled.words[0]);
const result = sim._execDwrite(decoded);

check('MBD-1 immediate-mode marker decodes to effective offset zero',
    decoded.imm === 0x4000 && result && result.desc.includes('M_BIT_DEV'));
check('MBD-2 DWRITE 0x1000 sets only CR12.M',
    sim.cr.map(cr => cr.m).join(',') === '0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0');
check('MBD-3 M-bit device write does not fault or halt',
    sim.faultLog.length === 0 && !sim.halted);

if (failed) process.exit(1);