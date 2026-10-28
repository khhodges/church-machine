'use strict';
// Offline, disposable candidate builder; never a publication/admission helper.
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const Simulator = require('./simulator');
global.ChurchAssembler = require('./assembler');
const Compiler = require('./cloomc_compiler');
const Builder = require('./lump_builder');
const {sources} = require('./attack_progress_sources');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const BASELINE = '1c8673dd39ebd7fd196a5e0f8d59c4119bc4f2298ebf7c187792c6f2b4d42336';
const root = {word0:0x02000001,word1:0,word2:255,word3:0,m:1};
const slots = {'ide.SelfTest':6, 'ide.WukongCallHome':7, 'ide.LED_DEV':3,
    'ide.UART_DEV':8, 'ide.BTN_DEV':4, 'ide.TIMER_DEV':5, 'ide.M_BIT_DEV':13,
    'ide.CapabilityTest':10, 'ide.Thread2':11, 'ide.Thread3':12,
    'ide.BootThread':2, 'ide.Alice':16, 'ide.Mallory':17,
    'ide.AliceDriver':18, 'ide.MalloryDriver':19, 'ide.AmoebaStartup':21};
function compile(source) {
    const result = new Compiler().compileAssembly(source, []);
    assert.deepEqual(result.errors, []);
    const built = Builder.buildLump(result);
    assert(!built.errors?.length, JSON.stringify(built.errors));
    return {result, built};
}
function resolved(source) {
    const probe = compile(source.replace(/@\w+@/g, '0'));
    const offsets = {};
    for (const [name, marker] of Object.entries({expected:0x4eca0001,
        sample:0x4eca0002,valid:0x4eca0003,fault:0x4eca0004})) {
        const index = probe.built.words.indexOf(marker);
        if (index >= 0) offsets[name] = index;
    }
    if (offsets.fault) for (let i=0;i<10;i++) offsets['div'+i]=offsets.fault+1+i;
    source = source.replace(/@(\w+)@/g, (_,name) => {
        assert(Number.isInteger(offsets[name]), name);
        return offsets[name];
    }).replace('.word 0x4eca0001', '.word 41')
        .replace(/\.word 0x4eca000[234]/g, '.word 0');
    return {source, offsets, ...compile(source)};
}
function create(baseline) {
    assert.equal(sha(baseline), BASELINE, 'Exact reviewed baseline required');
    const sim = Simulator.fromAscendingNamespaceImage(baseline, root);
    const bootBase = sim.readNSEntry(2).word0_location;
    const bootBefore = sim.memory.slice(bootBase, bootBase+256);
    const records = {};
    let cursor = 4096;
    for (const [name, source] of Object.entries(sources())) {
        const program = resolved(source), {built,result} = program, slot = slots[name];
        const words = built.words.slice();
        // Explicit pre-boot destination binding, no runtime resolution or grant.
        result.capabilities.forEach((cap,i) => {
            const target = cap.name === 'SELF' ? slot : slots[cap.name];
            assert(Number.isInteger(target), cap.name);
            const seq = sim.parseNSWord1(sim.readNSEntry(target).word1_limit).gtSeq;
            words[words.length-built.cc+i] = sim.createGT(seq,target,
                Object.fromEntries(cap.rights.map(r=>[r,1])),1);
        });
        assert(cursor+words.length <= sim.memory.length);
        const w1 = sim.packNSWord1(built.cw,0,0,0);
        sim.memory.set(words,cursor);
        sim.memory.set([cursor,w1,sim._integrity32(cursor,w1),0],slot*4);
        records[name] = {...program, slot, base:cursor, words,
            sourceHash:sha(program.source), binaryHash:sha(Buffer.from(new Uint32Array(words).buffer))};
        cursor += words.length;
    }
    // The existing prepared-Thread contract allows an explicit entry NIA.
    // Select each worker's startup method in this fresh candidate only; retain
    // its actor CR1, root sentinel, stack geometry and all other homes.
    const startup = records['ide.AmoebaStartup'];
    for (const [slot, selector] of [[11,2],[12,3]]) {
        const base = sim.readNSEntry(slot).word0_location;
        const layout = sim._threadLayoutAtBase(base);
        const resume = sim._readThreadResumeFrame(base,layout,slot);
        const indicator = sim._unpackProtectedIndicator(sim.memory[base+layout.protectedStoOffset]);
        const nia = startup.words[selector]-1;
        sim.memory[base+indicator.sto+2] =
            sim._packFrameWordRaw(nia,1,resume.frame.savedSTO);
        assert.equal(sim._readThreadResumeFrame(base,layout,slot).resumePC,nia);
    }
    assert.deepEqual(sim.memory.slice(bootBase,bootBase+256),bootBefore,
        'Boot.Thread image bytes must remain unchanged');
    const image = sim.memory.slice(), imageHash = sha(Buffer.from(image.buffer));
    return {image, imageHash, records, bootBefore, bootBase};
}
function start(candidate) {
    const sim = Simulator.fromAscendingNamespaceImage(candidate.image, root);
    sim.configureBootFaultEntry({root,threadGT:0x02000002,
        handlerGT:sim.createGT(0,21,{E:1},1),imageIdentity:candidate.imageHash});
    sim.beginBoot({clearNonBootThreads:true,freshThreadSlots:[11,12]});
    for(let i=0;i<3;i++) assert(sim._bootStep(), JSON.stringify(sim.faultLog));
    return sim;
}
module.exports = {create,start,sha,BASELINE,resolved};
