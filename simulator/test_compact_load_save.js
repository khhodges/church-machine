'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
global.window = {};
global.ChurchAssembler = require('./assembler');
const A = global.ChurchAssembler;
const C = require('./cloomc_compiler');
const S = require('./simulator');
const IDE = require('./idx1-ide');

function assemble(source) {
    const result = new A().assemble(source);
    assert.deepEqual(result.errors, [], source);
    assert.equal(result.words.length, 1, source);
    return result.words[0];
}
// Literal words deliberately independent of the production encoder.
for (const [source, word] of [
    ['LOAD CR1, CR6, DR11 + 3', 0x070B003B],
    ['LOAD CR1, CR6, DR11 - 3', 0x070B403B],
    ['LOAD CR1, CR6, DR15 + 1023', 0x070B3FFF],
    ['LOAD CR1, CR6, DR15 - 1023', 0x070B7FFF],
    ['LOAD CR1, CR6, #3', 0x070B0030],
    ['SAVE CR2, CR6, DR11 + 3', 0x0F13003B],
    ['SAVE CR2, CR6, DR11 - 3', 0x0F13403B],
    ['SAVE CR2, CR6, #3', 0x0F130030],
]) {
    assert.equal(assemble(source), word, source);
    assert.equal(IDE.requiresProfile(source), false, 'ordinary IDE routing');
    assert.equal(assemble(new A().disassemble(word)), word, 'disassembly roundtrip');
}
for (const op of ['LOAD', 'SAVE']) {
    for (const bad of ['DR16', 'DR-1', 'DR1 + 1024', 'DR1 - 1024', '#1024',
        '#-1024', 'DR1 + -1', 'DR1 + 3 junk', 'DR1 DR2', '1.5']) {
        assert.ok(new A().assemble(`${op} CR1, CR6, ${bad}`).errors.length, bad);
    }
}
for (let r = 0; r < 16; r++) {
    assert.equal(assemble(`LOAD CR1, CR6, DR${r}`), 0x070B0000 | r);
    assert.equal(assemble(`LOAD CR1, CR6, DR${r} - 0`), 0x070B0000 | r);
    assert.equal(assemble(`LOAD CR1, CR6, DR${r} + 0`), 0x070B0000 | r);
}
assert.ok(new A().assemble('SAVE CR1, CR6, #0').errors.length, 'SELF remains immutable');
const named = new A().assemble('capabilities { SELF E, Foo E }\nLOAD CR1, Foo\nSAVE CR1, Foo');
assert.deepEqual(named.errors, []);
assert.deepEqual(named.words.map(w => w & 0x7FFF), [16, 16]);
assert.equal(new C().encode(0, 14, 1, 6, 3), 0x070B0030);
assert.equal(new C().encode(1, 14, 2, 6, 3), 0x0F130030);
assert.throws(() => new C().encode(0, 14, 1, 6, 1024), /1023/);
assert.equal(assemble('LOAD CR1, CR6, #-1023'), 0x070B7FF0);

function fixture(word) {
    const sim = new S();
    sim.bootComplete = false;
    // Disposable in-memory Namespace only; no saved files or images.
    sim.writeNSEntry(20, 0x200, 63, 0, 0, 1, 0, 4, 0);
    sim.writeNSEntry(21, 0x300, 63, 0, 0, 1, 0, 0, 0);
    sim.writeNSEntry(22, 0x400, 63, 0, 0, 1, 0, 0, 0);
    sim.bootComplete = true;
    // Fetch and mLoad mark authorized objects live independently of retirement.
    // Start them live so the snapshot measures instruction effects, not GC.
    for (const slot of [20, 21, 22]) sim.markLive(slot);
    const cr = (word0, word1, word2 = 0) => ({ word0, word1, word2, word3: 0, m: 0 });
    sim.cr[6] = cr(sim.createGT(0, 20, (word >>> 27) === 1 ? { S: 1 } : { L: 1 }, 1), 0x200, 4 << 17);
    sim.cr[14] = cr(sim.createGT(0, 22, { R: 1, X: 1 }, 1), 0x400);
    sim.cr[12] = cr(0, 0);
    const gt = sim.createGT(0, 21, { E: 1, B: (word >>> 27) === 1 ? 1 : 0 }, 1) >>> 0;
    for (let i = 0; i < 4; i++) sim.memory[0x200 + i] = gt;
    sim.cr[2] = cr(gt, 0x300);
    sim.memory[0x400] = ((31 << 27) | (1 << 10)) >>> 0;
    sim.memory[0x401] = word;
    sim.pc = 0;
    const faults = [];
    // Contain fault routing so tests can observe the instruction's exact writes.
    sim.fault = (type, message) => faults.push({ type, message });
    return { sim, gt, faults };
}
for (const op of ['LOAD', 'SAVE']) for (let r = 0; r < 16; r++) {
    for (const [suffix, base, index] of [['+ 3', 0, 3], ['- 3', 6, 3], ['', 3, 3],
        ['+ 0', 3, 3], ['- 0', 3, 3], ['- 1023', 1026, 3]]) {
        if (r === 0 && base !== 0) continue;
        const { sim, gt, faults } = fixture(assemble(`${op} CR2, CR6, DR${r} ${suffix}`));
        sim.dr[r] = base;
        const result = sim.step();
        assert.deepEqual(faults, [], `${op} DR${r} ${suffix}`);
        assert.ok(result);
        assert.equal(sim.pc, 1, 'one instruction, one word');
        if (op === 'LOAD') assert.equal(sim.cr[2].word0 >>> 0, gt);
        else assert.equal(sim.memory[0x200 + index] >>> 0, gt);
    }
}
for (const op of ['LOAD', 'SAVE']) {
    for (const [expression, value] of [['DR11 + 1', 0xFFFFFFFF],
        ['DR11 - 1', 0], ['DR11', 0xFFFFFFFF], ['DR11', 4], ['DR11 + 1023', 1]]) {
        const { sim, faults } = fixture(assemble(`${op} CR2, CR6, ${expression}`));
        sim.dr[11] = value;
        const beforeCR = JSON.stringify(sim.cr);
        const beforeMemory = sim.memory.slice();
        const beforeDR = Array.from(sim.dr);
        sim.step();
        assert.ok(faults.length, `${op} ${expression} ${value} must fault`);
        assert.equal(JSON.stringify(sim.cr), beforeCR, 'fault must not change CRs or M');
        assert.deepEqual(sim.memory, beforeMemory, 'fault must not change memory');
        assert.deepEqual(Array.from(sim.dr), beforeDR, 'index DR must not change');
        assert.equal(sim.pc, 0);
    }
}
// Unsigned DR handling, exact upper boundary, and negative zero raw decode.
{
    const { sim, faults } = fixture(0);
    sim.dr[15] = -1;
    assert.equal(sim._resolveCompactIndex(sim.decodeInstruction(0x070B000F)).imm, 0xFFFFFFFF);
    assert.equal(sim._resolveCompactIndex(sim.decodeInstruction(0x070B7FFF)).imm, 0xFFFFFC00);
    assert.equal(sim._resolveCompactIndex(sim.decodeInstruction(0x070B400F)).imm, 0xFFFFFFFF);
    assert.deepEqual(faults, []);
}
// SAVE still checks destination S and isolated source M; faults cannot consume M.
for (const isolated of [false, true]) {
    const { sim, faults } = fixture(assemble(`SAVE CR${isolated ? 12 : 2}, CR6, DR11`));
    sim.dr[11] = 1;
    if (!isolated) sim.cr[6].word0 = sim.createGT(0, 20, { L: 1 }, 1);
    const before = sim.memory.slice();
    const crBefore = JSON.stringify(sim.cr);
    sim.step();
    assert.ok(faults.length, 'missing permission must fault');
    assert.deepEqual(sim.memory, before);
    assert.equal(JSON.stringify(sim.cr), crBefore);
}
// Runtime-selected row zero is forbidden, even though its source compiles.
{
    const { sim, faults } = fixture(assemble('SAVE CR2, CR6, DR11 - 3'));
    sim.dr[11] = 3;
    const before = sim.memory.slice();
    sim.step();
    assert.equal(faults[0].type, 'IMMUTABLE_SELF_CAP');
    assert.deepEqual(sim.memory, before);
}
// Predicate failure must not evaluate even an overflowing operand.
{
    const { sim, faults } = fixture(assemble('LOADNV CR2, CR6, DR11 + 1'));
    sim.dr[11] = 0xFFFFFFFF;
    const before = JSON.stringify(sim.cr);
    sim.step();
    assert.deepEqual(faults, []);
    assert.equal(JSON.stringify(sim.cr), before);
    assert.equal(sim.pc, 1);
}
// Non-CR6 access still requires L authority. Indexing cannot confer it.
{
    const { sim, faults } = fixture(assemble('LOAD CR2, CR3, DR11'));
    sim.cr[3] = { ...sim.cr[6], word0: sim.createGT(0, 20, { S: 1 }, 1) };
    const before = JSON.stringify(sim.cr);
    sim.step();
    assert.ok(faults.length);
    assert.equal(JSON.stringify(sim.cr), before);
}
// Public worker -> ordinary compiler output -> real fetch/decode/step.
for (const op of ['LOAD', 'SAVE']) {
    const source = `; @abstraction CompactIndex\n${op} CR2, CR6, DR11 - 3\nHALT`;
    const response = JSON.parse(execFileSync(process.execPath, ['server/compile_worker.js'], {
        input: JSON.stringify({ source, language: 'assembly' }), encoding: 'utf8',
    }));
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.notEqual(response.isa_profile, 'IDX1');
    const words = response.words.slice(2, 4); // header + canonical method dispatch prefix
    assert.equal(words.length, 2);
    assert.equal(words[0], op === 'LOAD' ? 0x0713403B : 0x0F13403B);
    const { sim, gt, faults } = fixture(words[0]);
    sim.dr[11] = 6;
    assert.ok(sim.step());
    assert.deepEqual(faults, []);
    assert.equal(sim.pc, 1);
    assert.equal(sim.cr[2].word0 >>> 0, gt);
}
console.log('PASS compact LOAD/SAVE literal words, all DRs, arithmetic, containment, permissions, public compile-through-step');