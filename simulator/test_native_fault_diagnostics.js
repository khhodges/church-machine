'use strict';
const assert = require('node:assert/strict');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
const Compiler = require('./cloomc_compiler');
const Simulator = require('./simulator');
const Assembler = require('./assembler');

function compile(body) {
    return new Compiler().compile(`abstraction test.NativeFault {
capabilities { SELF E, test.Target E }
method Run() {
${body}
}
}`, []);
}
function trial(body) {
    const result = compile(body);
    assert.deepEqual(result.errors, []);
    const words = result.methods[0].code;
    const {sim, install, activate} = fixture();
    const domain = install(30, words);
    activate(domain);
    sim.fault = Simulator.prototype.fault;
    sim.registerNativeFaultDiagnostics(words, domain.base + 1);
    let fault;
    sim.on('fault', event => { fault = event; });
    return {sim, words, result, domain, run() { sim.step(); return fault; }};
}

for (const body of ['HARDFAULT BAD_TYPE', 'HARDFAULT "Invalid queue state"']) {
    const t = trial(body);
    assert.equal(t.words[0], 0xf7000000, 'existing fail-closed encoding');
    const fault = t.run();
    assert.equal(fault.type, 'INVALID_OP');
    assert.match(fault.message, /authored HARDFAULT/);
    assert.match(fault.message, /Run, source line 4/);
    assert.match(fault.message, body.includes('"') ? /Invalid queue state/ : /BAD_TYPE/);
    assert.doesNotMatch(fault.message, /Bind Namespace|unresolved symbolic CALL/);
    const raw = trial(body);
    raw.sim.registerNativeFaultDiagnostics(raw.words.slice(), raw.domain.base + 1);
    const rawFault = raw.run();
    const executionEvidence = event => Object.fromEntries(Object.entries(event)
        .filter(([key]) => !['message', 'diagnosticNote', 'rawDiagnosticReason'].includes(key)));
    assert.deepEqual(executionEvidence(fault), executionEvidence(rawFault),
        'diagnostic provenance must not change fault evidence');
    assert.equal(t.sim.pc, raw.sim.pc);
    assert.equal(t.sim.halted, raw.sim.halted);
    assert.equal(t.sim.stepCount, raw.sim.stepCount);
    assert.deepEqual(t.sim.cr, raw.sim.cr);
    assert.deepEqual(t.sim.memory, raw.sim.memory);
}

// Mutable manifests cannot replace the compiler's private diagnostic snapshot.
{
    const t = trial('HARDFAULT ORIGINAL');
    t.result.manifest[0].mapping[0].hardfault.reason = 'FORGED';
    assert.match(t.run().message, /ORIGINAL/);
}
// Raw historical placeholders and WORD data are indistinguishable without
// exact provenance. They still fault, but must not assert a binding diagnosis.
for (const raw of [0xf7000000, 0xf0000000]) {
    const t = trial('HARDFAULT ORIGINAL');
    t.sim.memory[t.domain.base + 1] = raw;
    t.sim.registerNativeFaultDiagnostics([raw], t.domain.base + 1);
    // EQ is taken for the historical conditional placeholder.
    t.sim.flags.Z = true;
    const fault = t.run();
    assert.equal(fault.type, 'INVALID_OP');
    assert.match(fault.message, /No exact compiler provenance/);
    assert.doesNotMatch(fault.message, /authored HARDFAULT ORIGINAL|Bind Namespace/);
}
{
    const t = trial('HARDFAULT ORIGINAL');
    t.sim.memory[t.domain.base + 2] ^= 1;
    assert.match(t.run().message, /No exact compiler provenance/,
        'surrounding method bytes are part of the evidence');
}
{
    const t = trial('HARDFAULT ORIGINAL');
    t.words[1] ^= 1;
    assert.equal(t.sim.registerNativeFaultDiagnostics(t.words, t.domain.base + 1), false);
    assert.match(t.run().message, /No exact compiler provenance/);
}
{
    const t = trial('HARDFAULT ORIGINAL');
    const address = t.domain.base + 1;
    t.sim.reset();
    t.sim.memory.set(t.words, address);
    assert.match(t.sim._nativeTrapDiagnostic(t.words[0], address), /No exact compiler provenance/);
}
{
    const t = trial('HARDFAULT ORIGINAL\nIADD DR2, DR0, #123');
    t.sim.loadProgram(t.words.slice(), 0, t.domain.slot);
    assert.match(t.run().message, /authored HARDFAULT ORIGINAL/,
        'ordinary method loading attaches exact compiler evidence');
}
{
    const t = trial('HARDFAULT ORIGINAL');
    t.sim.memory[t.domain.base + 1] = 0xf0000000;
    t.sim.flags.Z = false;
    assert.equal(t.run(), undefined, 'untaken conditional placeholder must not fault');
}
// Genuine unencodable CALLs remain compile errors, never new executable traps.
for (const body of ['CALL test.Target', 'CALLEQ test.Target.Run']) {
    const result = compile(body);
    assert(result.errors.some(e => /Cannot encode CALL.*unresolved/.test(e.message)));
}
// An encodable CALL through an unresolved C-list row still fails at runtime.
{
    const result = new Assembler().assemble(
        'capabilities { SELF E, test.Target E }\nCALL CR6[test.Target], #0');
    assert.deepEqual(result.errors, []);
    const {sim, install, activate} = fixture();
    const domain = install(30, result.words, [0]);
    activate(domain);
    sim.fault = Simulator.prototype.fault;
    let fault;
    sim.on('fault', event => { fault = event; });
    sim.step();
    assert(fault, 'unbound CALL must not execute successfully');
    assert.doesNotMatch(fault.message, /authored HARDFAULT/);
}
console.log('PASS native fault provenance, raw traps, and unbound CALL rejection');

// Browser script compilation (no CommonJS export), followed by the IDE's
// concatenation/copy loading and the canonical builder's private-branch fixups.
{
    const vm = require('node:vm');
    const fs = require('node:fs');
    const browser = vm.createContext({console, require, ChurchAssembler: Assembler,
        AbstractGTManager: require('./abstract_gt_manager').AbstractGTManager});
    vm.runInContext(fs.readFileSync(__dirname + '/cloomc_compiler.js', 'utf8'), browser);
    vm.runInContext(fs.readFileSync(__dirname + '/simulator.js', 'utf8'), browser);
    const source = `abstraction test.Relocation {
capabilities { SELF E }
method Run() {
HARDFAULT RELOCATED
helper();
}
private method helper() {
RETURN
}
}`;
    browser.source = source;
    const result = vm.runInContext('new CLOOMCCompiler().compile(source, [])', browser);
    assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
    const proto = vm.runInContext('ChurchSimulator.prototype', browser);
    const {buildLump} = require('./lump_builder');
    const lump = buildLump(result);
    const flat = result.methods.flatMap(m => Array.from(m.code));
    const built = lump.words.slice(1, 1 + lump.cw);
    assert.notEqual(built[result.methods.length + 1], result.methods[0].code[1],
        'private-method branch really was relocated');
    for (const [words, offset] of [[flat, 0], [built, result.methods.length]]) {
        const {sim, install, activate} = fixture();
        const domain = install(30, words);
        activate(domain);
        // Use the actual browser-script diagnostic methods, with no module
        // export available in their lexical context.
        sim.registerNativeFaultDiagnostics = proto.registerNativeFaultDiagnostics;
        sim._nativeTrapDiagnostic = proto._nativeTrapDiagnostic;
        sim.loadProgram(Array.from(words), 0, domain.slot);
        sim.pc = offset;
        sim.fault = Simulator.prototype.fault;
        let fault;
        sim.on('fault', event => {fault = event;});
        sim.step();
        assert.equal(fault.type, 'INVALID_OP');
        assert.match(fault.message, /authored HARDFAULT RELOCATED/);
        sim.memory[domain.base + 2 + offset] ^= 1;
        assert.match(sim._nativeTrapDiagnostic(0xf7000000, domain.base + 1 + offset),
            /No exact compiler provenance/);
    }
    browser.source = source.replace('RELOCATED', 'DIFFERENT_REASON');
    vm.runInContext('new CLOOMCCompiler().compile(source, [])', browser);
    browser.words = built;
    assert.equal(vm.runInContext('CLOOMCCompiler.getNativeFaultImage(words)', browser), null,
        'identical final bytes with different source reasons are ambiguous');
}
console.log('PASS browser copied-code and relocated LUMP fault provenance');
