'use strict';
// Disposable compiler/runtime checks, not an installed-image or FPGA pass.
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.ChurchAssembler = require('./assembler');
const Compiler = require('./cloomc_compiler');
const {buildLump} = require('./lump_builder');
const {installThreadDriver, threadGT} =
    require('./test_alice_mallory_thread_setup');
const Simulator = require('./simulator');
const crypto = require('node:crypto');

function createAliceMalloryThreadFixture() {
    // Pin the reviewed image instead of booting the mutable current catalog.
    const bytes = fs.readFileSync(__dirname +
        '/../generated-artifacts/uart-packet-atomic-validation/source-snapshot/generated-artifacts/data-access-validation/admitted.bin');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),
        'e8ba3755a56fa69308de1154e442529b6cadef6a8a98e10b6976a09137fe9102');
    const root = {word0:0x02000001, word1:0, word2:255, word3:0, m:1};
    const sim = Simulator.fromAscendingNamespaceImage(bytes, root);
    // Imported catalog hints are frozen; the disposable fixture's UI hints
    // must be private before installing its test-only residents.
    sim._nsUiTypeHint = {...sim._nsUiTypeHint};
    sim._nsClistCount = {...sim._nsClistCount};
    sim._nsSymbolicEntries = {...sim._nsSymbolicEntries};
    sim._nsFreeSequences = {...sim._nsFreeSequences};
    sim.configureBootFaultEntry({root, threadGT:0x02000002,
        handlerGT:sim.createGT(0,21,{E:1},1), imageIdentity:'isolated-retry-fixture'});
    sim.beginBoot({clearNonBootThreads:true, freshThreadSlots:[11,12]});
    for (let i=0;i<3;i++) assert(sim._bootStep(), JSON.stringify(sim.faultLog));
    const bodies = [2,11,12].map(slot => {
        const base = sim.readNSEntry(slot).word0_location;
        return {slot,base,layout:sim._threadLayoutAtBase(base)};
    });
    return {sim,bodies,nextBase:8192};
}

function compile(source) {
    const result = new Compiler().compileAssembly(source, []);
    assert.deepEqual(result.errors, []);
    const built = buildLump(result);
    assert(!built.errors?.length);
    return {result, code: built.words.slice(1, 1 + built.cw)};
}
const source = fs.readFileSync(__dirname + '/examples/candidates/amoeba-retry.cloomc', 'utf8');
const candidate = compile(source);
assert.deepEqual(candidate.code.slice(0, 3), [4, 10, 13], 'method offsets unchanged');
const frozen = fs.readFileSync(__dirname +
    '/../generated-artifacts/uart-packet-atomic-validation/source-snapshot/generated-artifacts/data-access-validation/admitted.bin');
const frozenCode = Array.from({length:15}, (_,i) => frozen.readUInt32LE(0x4604 + i*4));
const changed = candidate.code.flatMap((w,i) => (w >>> 0) === frozenCode[i] ? [] : [i]);
assert.deepEqual(changed, [7,8,10,11,13,14], 'only three terminal pairs change');
for (const i of [7,10,13]) {
    assert.equal(frozenCode[i], 0, 'old HALT word');
    assert.equal(frozenCode[i+1], 0x1f000000, 'old implicit RETURN');
}
assert(candidate.result.methods.every(m => m.isMain));
for (const method of candidate.result.methods) {
    assert(method.code.every(w => (w >>> 27) !== 3), 'no RETURN in root entry');
    assert.equal(method.code.at(-2) >>> 27, 23, 'branch before padding');
    assert.equal(method.code.at(-2) >>> 0, 0xbf040001, 'unconditional backward branch to CALL');
}
const illegal = new Compiler().compileAssembly(source.replace('BRANCH Retry', 'RETURN'), []);
assert(illegal.errors.some(e => e.message.includes('[MAIN]')), 'explicit root RETURN rejected');

const manager = compile(`abstraction test.Manager {
 capabilities { SELF E }
 main method Run() { CHANGE CR2
 Again:
 BRANCH Again
 }
}`);
const reporter = compile(`abstraction test.Reporter {
 capabilities { SELF E }
 method A() { RETURN }
 method B() { RETURN }
 method C() { RETURN }
}`);
function application(fault) {
    return compile(`abstraction test.Application {
 capabilities { SELF E }
 method Run() { RETURN }
 method Alice() { RETURN }
 method Mallory() { ${fault ? 'LOAD CR1, CR6, #2' : 'RETURN'} }
}`);
}

function scenario(selector, fault = false, status = 0) {
    const {sim, bodies, nextBase} = createAliceMalloryThreadFixture();
    const app = application(fault);
    const installedApp = installThreadDriver(sim, 34, nextBase + 128, app.code, 'return fixture');
    const installedReporter = installThreadDriver(sim, 35, nextBase + 192, reporter.code, 'status fixture');
    const starter = installThreadDriver(sim, 33, nextBase + 64, candidate.code,
        'isolated Amoeba retry', [installedApp.gt, installedReporter.gt]);
    const supervisor = installThreadDriver(sim, 32, nextBase, manager.code, 'manager');
    const body = bodies[selector === 2 ? 2 : 1];
    const other = bodies[selector === 2 ? 1 : 2];
    const untouched = Array.from(sim.memory.slice(other.base, other.base + other.layout.lumpSize));
    // Privileged fixture setup only; not a runtime Thread-priming implementation.
    sim.memory.fill(0, body.base + 1, body.base + body.layout.lumpSize);
    const root = body.layout.stackEnd - 2, sto = root - 2;
    sim.memory[body.base + root + 1] = starter.gt;
    sim.memory[body.base + root + 2] = sim._packFrameWordRaw(0x7fff, 1, body.layout.stackEnd);
    sim.memory[body.base + sto + 1] = starter.gt;
    sim.memory[body.base + sto + 2] = sim._packFrameWordRaw(candidate.code[selector] - 1, 1, root);
    sim.memory[body.base + body.layout.protectedStoOffset] =
        sim._packProtectedIndicator(sto, 1, {}, 0);
    sim.memory[body.base + body.layout.capsStart] = starter.gt;
    sim.memory[body.base + body.layout.drStart + 3] = status;
    const entry = sim.readNSEntry(supervisor.slot);
    sim._writeCR(0, supervisor.gt, entry);
    sim._installLumpHeaderContext(sim.parseGT(supervisor.gt), supervisor.slot, entry, supervisor.header);
    sim.pc = manager.code[0] - 1;
    sim._writeCR(2, threadGT(sim, body.slot), sim.readNSEntry(body.slot));
    let calls = 0, reports = 0, before = null, faultOwner = null;
    const depths = [];
    for (let step = 0; step < 2000 && !sim.halted && calls < 101; step++) {
        const owner = sim.cr[14].word0 & 0xffff;
        if (owner === installedApp.slot && before !== owner) {
            calls++; depths.push(sim.sto);
        }
        if (owner === installedReporter.slot && before !== owner) reports++;
        before = owner;
        const executingThread = sim.cr[12].word0 & 0xffff;
        sim.step();
        if (sim.faultLog.length) {
            faultOwner = executingThread;
            break; // Observe first fault; do not exercise simulator recovery.
        }
    }
    assert.deepEqual(Array.from(sim.memory.slice(other.base, other.base + other.layout.lumpSize)),
        untouched, 'unrelated Thread untouched');
    assert.equal(sim.memory[body.base + root + 2],
        sim._packFrameWordRaw(0x7fff, 1, body.layout.stackEnd), 'root marker preserved');
    if (fault) {
        assert.equal(calls, 1, 'hard fault does not automatically retry');
        assert(sim.faultLog.length, 'missing capability faults');
        assert.equal(faultOwner, body.slot, 'fault belongs to Mallory Thread');
    } else {
        assert.equal(sim.faultLog.length, 0, JSON.stringify(sim.faultLog));
        assert.equal(calls, 101, '100 completed calls followed by retry');
        assert.equal(new Set(depths).size, 1, 'no per-retry stack growth');
        assert.equal(reports, selector === 0 && status ? 1 : 0,
            'startup reporting runs once, not on each retry');
    }
}
for (const selector of [0, 1, 2]) scenario(selector);
scenario(0, false, 2);
scenario(2, true);
console.log('PASS: 3 non-returning entries; 100 returns/retries each; stable stack; one-time startup; first fault belongs to Mallory. Recovery not exercised.');
