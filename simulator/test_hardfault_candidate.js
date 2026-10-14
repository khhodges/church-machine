'use strict';
// Selected encoding only: compiler lowering remains disabled pending map/integration gates.
const assert = require('assert');
const Simulator = require('./simulator.js');
const Assembler = require('./assembler.js');
const CANDIDATE = 0xF7000000;
let navigationFault;
const asm = new Assembler();
assert.strictEqual(asm._assembleLine('WORD 0x07000000', 1, 0), CANDIDATE);
assert.strictEqual(asm.disassemble(CANDIDATE), 'WORD 0x7000000');
assert(new Assembler().assemble('HARDFAULT PASSKEY_MISMATCH').errors.length,
    'this investigation must not enable pseudo-instruction emission');

for (let bits = 0; bits < 16; bits++) {
    const sim = new Simulator();
    sim.bootComplete = true;
    sim.halted = false;
    const base = 0x900;
    const words = [0xF8000C00, 0xAF084001, CANDIDATE, 0xAF104002];
    words.forEach((word, i) => { sim.memory[base + i] = word; });
    sim.cr[14] = {word0: sim.createGT(0, 7, {R: 1, X: 1}, 1),
        word1: base, word2: 3, word3: 0, m: 0};
    sim._slotIdentity.set(7, {secure: true, binaryHash: 'a'.repeat(64)});
    sim.nsLabels[7] = 'CandidateProbe';
    sim.pc = 1; // zero-based code index; LUMP offset is pc+1
    sim.physicalPC = 0; // real fetch must compute the originating physical address
    for (let i = 1; i < 16; i++) sim.dr[i] = 0x12000000 + i;
    sim.flags = {N: !!(bits & 1), Z: !!(bits & 2), C: !!(bits & 4), V: !!(bits & 8)};
    // Isolate Namespace admission, but exercise real address calculation/fetch.
    sim.mLoad = () => ({ok: true, index: 7});
    const fetchInstruction = sim._fetchInstruction.bind(sim);
    let fetches = 0;
    sim._fetchInstruction = () => {
        fetches++;
        return fetchInstruction();
    };
    const state = () => JSON.stringify({
        cr: sim.cr, dr: Array.from(sim.dr), flags: sim.flags, pc: sim.pc,
        sto: sim.sto, callStack: sim.callStack, memory: Array.from(sim.memory),
    });
    const before = state();
    assert.strictEqual(sim.step(), null);
    const fault = sim.faultLog.at(-1);
    navigationFault = fault;
    assert.strictEqual(fault.type, 'INVALID_OP');
    assert.strictEqual(fault.faultCode, 0xB);
    assert.strictEqual(fault.faultRawWord, CANDIDATE);
    assert.strictEqual(fault.pc, 1);
    assert.strictEqual(fault.physicalPC, base + 2);
    assert.strictEqual(fault.instrHistory.at(-1).physicalPC, base + 2);
    assert.deepStrictEqual(fault.flagsSnapshot, sim.flags);
    assert.deepStrictEqual(fault.crSnapshot, sim.cr);
    assert.deepStrictEqual(fault.drSnapshot, Array.from(sim.dr));
    assert.deepStrictEqual(fault.faultCodeWords, words);
    assert.strictEqual(fault.executionArtifact.identity.binaryHash, 'a'.repeat(64));
    assert.strictEqual(state(), before, 'fault must not modify architectural state or memory');
    assert(sim.halted && !sim.running);
    assert.strictEqual(sim.step(), null);
    assert.strictEqual(fetches, 1, 'no fall-through to the instruction after HARDFAULT');
    assert.strictEqual(sim.faultLog.length, 1);
    const captured = JSON.stringify(fault);
    sim.memory[base + 2] = 0;
    sim._slotIdentity.set(7, {binaryHash: 'b'.repeat(64)});
    sim.reset();
    assert.strictEqual(JSON.stringify(fault), captured, 'origin survives reset/replacement');
}

// Negative control: arbitrary WORD payloads are NOT unconditional simulator faults.
const sim = new Simulator();
sim.bootComplete = true;
sim.halted = false;
sim.flags.Z = false;
sim._fetchInstruction = () => ({ok: true, word: 0xF0000000, addr: 0});
assert.strictEqual(sim.step().skipped, true);
assert.strictEqual(sim.faultLog.length, 0);
// Feed actual captured evidence into the existing IDE attribution gate.
// This verifies disassembly attribution, NOT a not-yet-implemented reason map.
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
const start = source.indexOf('function _revealFaultInstruction(');
const end = source.indexOf('// Keep the last exact binary', start);
assert(start >= 0 && end > start);
let status = '';
let rows = [];
const binary = {token: 'candidate', words: navigationFault.faultCodeWords.slice(),
    binaryHash: navigationFault.executionArtifact.identity.binaryHash};
const ctx = {
    window: {_faultNavigationBinary: binary},
    document: {
        getElementById: id => id === 'asmEditor' ? null : {
            set textContent(value) { rows = []; },
            appendChild(row) { rows.push(row); },
        },
        createElement: () => ({style: {}, setAttribute() {}, scrollIntoView() {}}),
    },
    assembler: asm,
    switchCodeTab() {},
    _setDisassemblyPresentationStatus(value) { status = value; },
};
vm.createContext(ctx);
vm.runInContext(source.slice(start, end), ctx);
const evidence = {artifact: navigationFault.executionArtifact,
    codeWords: navigationFault.faultCodeWords, occurrence: navigationFault.executionOccurrence};
assert.strictEqual(ctx._revealFaultInstruction('candidate', navigationFault.pc + 1,
    CANDIDATE, evidence), true);
assert.strictEqual(rows[1].className, 'fault-code-line-highlight');
assert.match(rows[1].textContent, /^\+2  0xf7000000/);
binary.binaryHash = 'b'.repeat(64);
assert.strictEqual(ctx._revealFaultInstruction('candidate', 2, CANDIDATE, evidence), false);
assert.match(status, /different saved revision/);
binary.binaryHash = navigationFault.executionArtifact.identity.binaryHash;
binary.words[1] ^= 1; // same fault word, different surrounding code
assert.strictEqual(ctx._revealFaultInstruction('candidate', 2, CANDIDATE, evidence), false);
assert.match(status, /identity unverified/);
binary.words[1] ^= 1;
assert.strictEqual(ctx._revealFaultInstruction('candidate', 1, CANDIDATE, evidence), false);
assert.strictEqual(ctx._revealFaultInstruction('candidate', 2, CANDIDATE, null), false);
console.log('HARDFAULT candidate: all 16 flag states, immutable origin, no fall-through PASS');
console.log('HARDFAULT candidate: IDE exact loaded-code attribution and fail-closed mismatches PASS');
