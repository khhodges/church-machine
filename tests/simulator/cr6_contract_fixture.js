'use strict';

// Private simulator RAM only. No catalog, disk image, server or board writes.
const assert = require('node:assert/strict');
global.window = {bootConfig: {step1: {
    totalNamespaceWords: 16384, namespaceLumpWords: 1024,
    threadLumpWords: 512, threadCount: 1,
}}};
const Sim = require('../../simulator/simulator');
global.ChurchAssembler = require('../../simulator/assembler');
const Compiler = require('../../simulator/cloomc_compiler');
const {assembleLump} = require('../../simulator/lump_assembler');

function fixture(protectedThread = false) {
    const sim = new Sim();
    if (protectedThread) {
        for (let i = 0; !sim.bootComplete && !sim.halted && i < 32; i++) sim._bootStep();
        assert(sim.bootComplete && !sim.halted);
    } else {
        sim.bootComplete = true;
        sim.cr = Array.from({length: 16}, () =>
            ({word0: 0, word1: 0, word2: 0, word3: 0, m: 0}));
    }
    sim.mElevation = 0;
    sim.halted = false;
    sim.fault = (type, message) => assert.fail(`${type}: ${message}`);
    let nextBase = 0x2000;
    function install(slot, code, caps = []) {
        const cc = caps.length + 1;
        let size = 64;
        while (size < code.length + cc + 1) size *= 2;
        const base = nextBase;
        nextBase += size;
        assert(nextBase <= sim.NS_TABLE_BASE);
        assert(sim.memory.slice(base, nextBase).every(w => w === 0));
        const words = new Uint32Array(size);
        words[0] = sim.packLumpHeader(Math.log2(size) - 6, code.length, cc, 0);
        words.set(code, 1);
        words[size - cc] = Sim.SELF_CAPABILITY_PLACEHOLDER;
        words.set(caps, size - cc + 1);
        const hdr = sim.parseLumpHeader(words[0]);
        assert(sim.mintStep7Freespace(words, hdr).ok);
        const minted = sim._mintOrdinaryLumpIdentity(words, slot, base, {compilerOwnedSelf: true});
        assert(minted.ok, minted.message);
        sim.memory.set(minted.words, base);
        sim.withNamespaceWrite('isolated CR6 contract fixture', () =>
            sim.writeNSEntry(slot, base, size - 1, 0, 0, 1,
                minted.entry.seq, cc, minted.entry.cacheToken));
        assert(sim.mLoad(minted.selfGT, 'E', 1).ok);
        return {slot, base, hdr, gt: minted.selfGT,
            clistBase: base + size - cc};
    }
    function compile(slot, body, caps = []) {
        const compiled = new Compiler().compile(
            `abstraction test.Domain${slot} {
                capabilities { SELF E }
                method Run() { ${body} }
            }`, []);
        assert.deepEqual(compiled.errors, []);
        const assembled = assembleLump(compiled.methods.map(m => m.code));
        assert.deepEqual(assembled.errors || [], []);
        return install(slot, assembled.buf.slice(1), caps);
    }
    function activate(domain) {
        sim._installLumpHeaderContext(sim.parseGT(domain.gt), domain.slot,
            sim.readNSEntry(domain.slot), domain.hdr);
        sim.pc = 0;
    }
    return {sim, install, compile, activate};
}

function checkContext(sim, domain) {
    assert.equal(sim.cr[6].word0, domain.gt, 'CR6 retains the exact E GT');
    assert.equal(sim.cr[6].word0 & 0x70000000, 0x40000000, 'E only, never L');
    assert.equal(sim.cr[6].word1, domain.clistBase, 'CR6 names c-list, not header');
    assert.equal(sim.cr[6].m, 1, 'boundary explicitly arms CR6.M');
    assert.equal(sim.cr[14].word1, domain.base, 'CR14 still names code header');
}

function reject(sim, operation, expected) {
    const previousFault = sim.fault;
    let fault;
    sim.fault = (type, message) => { fault = {type, message}; };
    try {
        assert.equal(operation(), null, 'rejected instruction must not retire');
        assert.equal(fault?.type, expected, JSON.stringify(fault));
    } finally {
        sim.fault = previousFault;
    }
}
module.exports = {Sim, fixture, checkContext, reject};
