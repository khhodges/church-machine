'use strict';

// Disposable component evidence, NOT a working Mint service. All Namespace
// descriptors and initial capabilities are test provisioning. No mLoad,
// instruction, permission or continuation implementation is replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Simulator = require('./simulator');
const Assembler = require('./assembler');
const Thread = require('./thread_design');
const source = fs.readFileSync(path.join(__dirname, 'cloomc/mint.cloomc'), 'utf8');
const CODE = 0x2000, DATA = 0x3000;
function fragment(from, to) {
    const start = source.indexOf(from + ':');
    const end = source.indexOf(to + ':', start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
}
function fixture(text, size = 64) {
    const assembler = new Assembler();
    const program = assembler.assemble(text);
    assert.deepEqual(assembler.errors, []);
    const s = new Simulator();
    const token = (slot, rights) => s.createGT(0, slot,
        Object.fromEntries([...rights].map(p => [p, 1])), 1);
    s.withNamespaceWrite('TEST ONLY: native Mint fragments', () => {
        s.writeNSEntry(1, 0, 255, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(40, CODE, 255, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(41, DATA, size - 1, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(42, s.NS_TABLE_BASE, s.nsCount * 4 - 1,
            0, 0, 1, 0, 0, 0);
    });
    function install(reg, slot, rights) {
        const e = s.readNSEntry(slot);
        s.cr[reg] = {word0: token(slot, rights), word1: e.word0_location,
            word2: e.word1_limit, word3: 0, m: 0};
    }
    s.memory[0] = s.packLumpHeader(2, 32, 12, 2);
    const layout = Thread.layout(256, 32);
    s.memory[17] = s._packProtectedIndicator(layout.stackEnd - 4, 1, {}, 0);
    install(12, 1, '');
    s.memory[CODE] = s.packLumpHeader(2, program.words.length, 0, 0);
    s.memory.set(program.words, CODE + 1);
    install(14, 40, 'RX');
    install(6, 40, 'E');
    // Normal caller scope: C-list begins after this zero-row executable.
    s.cr[6].word1 = CODE + 256;
    s.cr[6].m = 1;
    install(8, 41, 'RW');
    install(9, 40, 'X');
    install(10, 42, 'RW');
    s.memory.fill(0xdeadbeef, DATA, DATA + size + 2);
    s.dr.fill(0);
    s.dr[6] = size;
    s.bootComplete = true;
    s.mElevation = false;
    s.petNameMemory.clear();
    s.programCapabilities = null;
    s.pc = 0;
    s.halted = false;
    return {s, labels: assembler.labels, token};
}
function runTo(s, end, limit = 10000) {
    let steps = 0;
    while (!s.halted && s.pc !== end && steps++ < limit) s.step();
    assert.equal(s.halted, false, JSON.stringify(s.faultLog));
    assert.ok(steps < limit, 'instruction budget exceeded');
    assert.equal(s.pc, end);
}

// Real indexed writes, bounds gates and instruction fetch, using the source
// verbatim. Ending at the next service boundary is NOT service completion.
for (const size of [8, 64, 256]) {
    const {s, labels} = fixture(
        fragment('create_data_zero_begin', 'create_data_publish') +
        '\ncreate_data_publish:\nHALT', size);
    runTo(s, labels.create_data_publish);
    assert.deepEqual(Array.from(s.memory.slice(DATA, DATA + size)), Array(size).fill(0));
    assert.equal(s.memory[DATA + size], 0xdeadbeef);
    assert.equal(s.memory[DATA + size + 1], 0xdeadbeef);
}

// Slot writes remain isolated from binding/exclusion and issuance. Test
// provisioning supplies an empty target and an internally consistent descriptor.
const slotText = fragment('create_data_slot_offset', 'create_data_slot_return');
const stops = [...new Set([...slotText.matchAll(/\bTODO_CREATE_\w+/g)].map(m => m[0]))];
const {s: slotSim, labels: slotLabels, token} = fixture(
    slotText + '\n' + stops.map(label => label + ':\nHALT').join('\n'));
const selected = 39, offset = slotSim.NS_TABLE_BASE + selected * 4;
// Test provisioning: choose an in-range empty slot, not an implicit table growth.
slotSim.memory.fill(0, offset, offset + 4);
const w1 = slotSim.packNSWord1(63, 0, 0, 0);
const descriptor = [DATA, w1, slotSim._integrity32(DATA, w1),
    token(selected, 'RW') >>> 0];
slotSim.dr[7] = selected;
descriptor.forEach((word, i) => { slotSim.dr[8 + i] = word; });
const before = Array.from(slotSim.memory.slice(slotSim.NS_TABLE_BASE,
    slotSim.NS_TABLE_BASE + slotSim.nsCount * 4));
runTo(slotSim, slotLabels.TODO_CREATE_CLEAR_NS_AUTHORITY);
const expected = before.slice();
expected.splice(selected * 4, 4, ...descriptor);
assert.deepEqual(Array.from(slotSim.memory.slice(slotSim.NS_TABLE_BASE,
    slotSim.NS_TABLE_BASE + slotSim.nsCount * 4)), expected);
assert.notEqual(slotSim.cr[10].word0, 0,
    'Authority remains at the unresolved erasure boundary; no false cleanup claim');

const {s: clearSim} = fixture('TPERM CR10, CLEAR\nHALT');
const retained = {...clearSim.cr[10]};
clearSim.step();
assert.equal(clearSim.halted, false, JSON.stringify(clearSim.faultLog));
assert.deepEqual(clearSim.cr[10], retained, 'TPERM CLEAR must not be modeled as erasure');

// Diagnose the actual ordinary LAMBDA boundary instead of silently adding a
// host PC redirect, as the separately scoped protected profile does.
const {s: lambdaSim, labels: lambdaLabels} = fixture(`
LAMBDA CR9
continuation:
HALT
intended_body:
IADD DR2, DR0, #777
RETURNAL
`);
lambdaSim.step();
assert.equal(lambdaSim.halted, false, JSON.stringify(lambdaSim.faultLog));
assert.equal(lambdaSim.pc, lambdaLabels.continuation,
    'Ordinary LAMBDA behavior changed: revisit the missing entry binding');
assert.equal(lambdaSim.lambdaActive, true);
assert.equal(lambdaSim.dr[2], 0);
assert.notEqual(lambdaSim.pc, lambdaLabels.intended_body);
assert.equal(lambdaSim.mLoad(lambdaSim.cr[9].word0, 'X', 9).ok, true,
    'The blocker must not be confused with a missing X permission');

// Independent RETURN probe, deliberately placed INLINE after LAMBDA. This
// diagnoses the existing SZ=0 unwind; it is NOT evidence of body entry.
// No runtime methods are replaced and no PC is redirected after provisioning.
for (const mask of [0, 4095]) {
    const {s: ret} = fixture(`LAMBDA CR9\nRETURNAL #${mask}\nHALT`);
    const context = [5, 6, 12, 13, 14, 15].map(i => ({...ret.cr[i]}));
    const indicator = ret._unpackProtectedIndicator(ret.memory[17]);
    const flags = {...ret.flags};
    const namespace = Array.from(ret.memory.slice(ret.NS_TABLE_BASE,
        ret.NS_TABLE_BASE + ret.nsCount * 4));
    ret.step();
    assert.equal(ret.pc, 1, 'Known fall-through, not successful private entry');
    assert.equal(ret.lambdaActive, true);
    const frame = ret._readProtectedCallFrame();
    assert.equal(frame.ok, true);
    assert.equal(frame.indicator.sz, 0);
    assert.equal(frame.frame.returnPC, 1);
    assert.equal(frame.frame.savedSTO, frame.frameAddress);
    // Ordinary implementation retains a cached frame, unlike protected Mint.
    assert.ok(ret.lambdaCachedFrame);
    ret.step();
    assert.equal(ret.halted, false, JSON.stringify(ret.faultLog));
    assert.equal(ret.pc, 1, 'RETURN restores the saved inline caller NIA');
    assert.equal(ret.physicalPC, CODE + 2);
    assert.equal(ret.lambdaActive, false);
    assert.equal(ret.lambdaCachedFrame, null);
    assert.equal(ret.callStack.length, 0);
    assert.deepEqual(ret._unpackProtectedIndicator(ret.memory[17]),
        {...indicator, nia: 1}, 'Protected STO/prior SZ restored with current NIA');
    assert.deepEqual(ret.flags, flags);
    const codeEntry = ret.readNSEntry(40);
    // CR6 identity/base survive; RETURN rederives descriptor metadata, including
    // the normal mLoad mark-live G bit and the Namespace integrity word.
    context[1].word2 = codeEntry.word1_limit;
    context[1].word3 = codeEntry.word2_seals;
    assert.deepEqual([5, 6, 12, 13, 14, 15].map(i => ret.cr[i]), context,
        'Caller scope identity, code fence and protected descriptors preserved');
    const withoutGC = words => words.map((word, i) =>
        i % 4 === 1 ? (word & ~0x40000000) >>> 0 : word);
    assert.deepEqual(withoutGC(Array.from(ret.memory.slice(ret.NS_TABLE_BASE,
        ret.NS_TABLE_BASE + ret.nsCount * 4))), withoutGC(namespace),
    'Namespace authority unchanged apart from native mLoad G-bit marking');
    for (const reg of [8, 9, 10]) {
        assert.equal(ret.cr[reg].word0 === 0, mask === 0,
            'Bare Lambda RETURN scrubs scratch authority; keep-mask retains it');
    }
}
console.log('PASS: native zeroing and exact-slot write/read-back fragments');
console.log('PASS: isolated inline SZ=0 RETURN restores caller context; mask behavior measured.');
console.log('BLOCKED: TPERM CLEAR does not erase capability authority.');
console.log('BLOCKED: ordinary LAMBDA falls through; no private-body entry binding. No complete CREATE claim.');
