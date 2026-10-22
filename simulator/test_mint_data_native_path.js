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
        fragment('create_data_zero_loop', 'create_data_publish') +
        '\ncreate_data_set_slot:\nHALT', size);
    s.dr[13] = 0;
    s.dr[14] = size;
    runTo(s, labels.create_data_set_slot);
    assert.deepEqual(Array.from(s.memory.slice(DATA, DATA + size)), Array(size).fill(0));
    assert.equal(s.memory[DATA + size], 0xdeadbeef);
    assert.equal(s.memory[DATA + size + 1], 0xdeadbeef);
}

// Slot writes remain isolated from binding/exclusion and issuance. Test
// Native allocator evidence: state and pool authority come from Mint's C-list,
// never caller CR7/CR8. Provisioning remains disposable, not a live installation.
const allocationText = fragment('create_data_allocate', 'create_data_zero_begin');
const allocationStops = [...new Set([...allocationText.matchAll(/\bTODO_CREATE_\w+/g)].map(m => m[0]))];
for (const scenario of ['success', 'pool-full', 'slots-full', 'bad-cursor', 'pool-bounds']) {
    const {s, labels, token} = fixture(allocationText +
        '\ncreate_data_publish:\nHALT\n' +
        allocationStops.map(label => label + ':\nLOAD CR0, CR6, #9').join('\n'), 64);
    const STATE = 0x4000;
    s.withNamespaceWrite('TEST ONLY: allocator state', () =>
        s.writeNSEntry(43, STATE, 63, 0, 0, 1, 0, 0, 0));
    s.memory[STATE] = s.packLumpHeader(0, 0, 1, 0);
    s.memory.set([8, 64, 7, 9, DATA * 4, 16, 39, 38], STATE + 1);
    s.memory[STATE + 16 + 39] = 512;
    if (scenario === 'pool-full') s.memory[STATE + 1] = 60;
    if (scenario === 'slots-full') s.memory[STATE + 3] = 9;
    if (scenario === 'bad-cursor') s.memory[STATE + 1] = 65;
    if (scenario === 'pool-bounds') s.memory.set([64, 128], STATE + 1);
    const beforeState = Array.from(s.memory.slice(STATE, STATE + 64));
    const header = s.parseLumpHeader(s.memory[CODE]);
    s.memory[CODE] = s.packLumpHeader(2, header.cw, 4, 0);
    s.cr[6].word1 = CODE + 252;
    s.memory.set([s.cr[6].word0, token(43, 'RW'), token(43, 'L'), token(41, 'RW')], CODE + 252);
    s.dr[6] = 8;
    s.dr[5] = 0x12345678;
    s.cr[7] = {word0: 0, word1: 0, word2: 0, word3: 0, m: 0};
    s.cr[8] = {...s.cr[7]};
    let steps = 0;
    while (!s.halted && s.pc !== labels.create_data_publish && steps++ < 1000) s.step();
    assert.ok(steps < 1000);
    assert.equal(s.dr[5], 0x12345678, 'allocator must preserve heap DR5');
    if (scenario === 'success') {
        assert.equal(s.halted, false, JSON.stringify(s.faultLog));
        assert.equal(s.pc, labels.create_data_publish);
        assert.equal(s.dr[7], 39);
        assert.equal(s.dr[8], (DATA + 8) * 4);
        assert.equal(s.dr[2], 0);
        assert.equal(s.dr[3], 1);
        assert.equal(s.memory[STATE + 1], 8);
        assert.equal(s.memory[STATE + 3], 7);
        assert.deepEqual(Array.from(s.memory.slice(DATA + 8, DATA + 16)), Array(8).fill(0xdeadbeef));
        assert.equal(s.memory[DATA + 7], 0xdeadbeef);
        assert.equal(s.memory[DATA + 16], 0xdeadbeef);
    } else {
        assert.equal(s.halted, true, scenario);
        assert.deepEqual(Array.from(s.memory.slice(STATE, STATE + 64)), beforeState);
        assert.equal(s.memory[DATA + 8], 0xdeadbeef);
    }
}
console.log('PASS: native bounded pool/slot reservation, exact zeroing, exhaustion and DR5 preservation.');

// Exact source entry and exit use ordinary BRANCH under CR14. No X capability
// is provisioned for the local label, and no caller continuation is consumed.
const localTransfer = fragment('create_data_set_slot', 'create_data_slot_after_clear') +
    '\ncreate_data_slot_after_clear:\nHALT\ncreate_data_slot_lambda:\n' +
    source.slice(source.indexOf('create_data_slot_return:'),
        source.indexOf('TODO_CREATE_INPUT_CREDENTIAL_NULL:'));
{
    const {s, labels} = fixture(localTransfer);
    s.cr[9] = {word0: 0, word1: 0, word2: 0, word3: 0, m: 0};
    const registers = JSON.parse(JSON.stringify(s.cr));
    const frames = JSON.parse(JSON.stringify(s.callStack));
    const sto = s.sto;
    s.step();
    assert.equal(s.pc, labels.create_data_slot_lambda);
    s.step();
    assert.equal(s.pc, labels.create_data_slot_after_clear);
    assert.equal(s.halted, false, JSON.stringify(s.faultLog));
    assert.deepEqual(s.cr, registers);
    assert.deepEqual(s.callStack, frames);
    assert.equal(s.sto, sto);
    assert.equal(s.lambdaActive, false);
}
console.log('PASS: exact local BRANCH entry/continuation uses unchanged CR14, with CR9 NULL and no frame changes.');
// Slot writes remain isolated from binding/exclusion and issuance. Test
// provisioning supplies an empty target and an internally consistent descriptor.
const slotText = fragment('create_data_slot_offset', 'create_data_slot_return');
const stops = [...new Set([...slotText.matchAll(/\bTODO_CREATE_\w+/g)].map(m => m[0]))];
const {s: slotSim, labels: slotLabels, token} = fixture(
    slotText + '\ncreate_data_slot_return:\nHALT\n' +
    stops.map(label => label + ':\nHALT').join('\n'));
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
runTo(slotSim, slotLabels.create_data_slot_return);
const expected = before.slice();
expected.splice(selected * 4, 4, ...descriptor);
assert.deepEqual(Array.from(slotSim.memory.slice(slotSim.NS_TABLE_BASE,
    slotSim.NS_TABLE_BASE + slotSim.nsCount * 4)), expected);
assert.notEqual(slotSim.cr[10].word0, 0,
    'Same-context Lambda RETURN must preserve Mint authority');

const {s: clearSim} = fixture('TPERM CR10, CLEAR\nHALT');
const retained = {...clearSim.cr[10]};
clearSim.step();
assert.equal(clearSim.halted, false, JSON.stringify(clearSim.faultLog));
assert.deepEqual(clearSim.cr[10], retained, 'TPERM CLEAR must not be modeled as erasure');

// Labels use an explicit CR alias and the unchanged register-form encoding.
// Provision the X view before execution, never redirect PC from a host hook.
function bindEntry(s, labels, name) {
    const address = CODE + 1 + labels[name];
    s.withNamespaceWrite('TEST ONLY: local X entry', () =>
        s.writeNSEntry(43, address, 0, 0, 0, 1, 0, 0, 0));
    const entry = s.readNSEntry(43);
    s.cr[9] = {word0: s.createGT(0, 43, {X: 1}, 1),
        word1: entry.word0_location, word2: entry.word1_limit, word3: 0, m: 0};
}
const {s: lambdaSim, labels: lambdaLabels} = fixture(`
.pet intended_body CR9
LAMBDA intended_body
continuation:
HALT
intended_body:
IADD DR2, DR0, #777
RETURNAL
`);
bindEntry(lambdaSim, lambdaLabels, 'intended_body');
assert.equal(lambdaSim.memory[CODE + 1],
    new Assembler().assemble('LAMBDA CR9').words[0],
    'Label alias must emit the existing register instruction unchanged');
lambdaSim.step();
assert.equal(lambdaSim.halted, false, JSON.stringify(lambdaSim.faultLog));
assert.equal(lambdaSim.pc, lambdaLabels.intended_body);
assert.equal(lambdaSim.lambdaActive, true);
assert.equal(lambdaSim.dr[2], 0);
assert.equal(lambdaSim.mLoad(lambdaSim.cr[9].word0, 'X', 9).ok, true,
    'Entry must have real X permission');
lambdaSim.step();
lambdaSim.step();
assert.equal(lambdaSim.pc, lambdaLabels.continuation);
assert.equal(lambdaSim.dr[2], 777);

const {s: outside} = fixture('LAMBDA CR9\nHALT');
bindEntry(outside, {bad: DATA - CODE - 1}, 'bad');
const priorSTO = outside._unpackProtectedIndicator(outside.memory[17]).sto;
const priorFrameWord = outside.memory[priorSTO];
outside.step();
assert.equal(outside.halted, true);
assert.equal(outside.faultLog.at(-1).type, 'BOUNDS');
assert.equal(outside.lambdaActive, false);
assert.equal(outside.callStack.length, 0);
assert.equal(outside.memory[priorSTO], priorFrameWord,
    'Out-of-body entry must fault before accepting a Lambda frame');

// Independent RETURN probes enter a separate body using an actual X view.
// No runtime methods are replaced and no PC is redirected after provisioning.
for (const mask of [0, 4095]) {
    const {s: ret, labels} = fixture(`LAMBDA CR9\ncontinuation:\nHALT\nbody:\nRETURNAL #${mask}`);
    bindEntry(ret, labels, 'body');
    const context = ret.cr.map(cr => ({...cr}));
    const indicator = ret._unpackProtectedIndicator(ret.memory[17]);
    const flags = {...ret.flags};
    const namespace = Array.from(ret.memory.slice(ret.NS_TABLE_BASE,
        ret.NS_TABLE_BASE + ret.nsCount * 4));
    ret.step();
    assert.equal(ret.pc, labels.body, 'X capability selects the local body');
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
    assert.equal(ret.pc, labels.continuation, 'RETURN restores the saved caller NIA');
    assert.equal(ret.physicalPC, CODE + 2);
    assert.equal(ret.lambdaActive, false);
    assert.equal(ret.lambdaCachedFrame, null);
    assert.equal(ret.callStack.length, 0);
    assert.deepEqual(ret._unpackProtectedIndicator(ret.memory[17]),
        {...indicator, nia: labels.body}, 'Protected STO/prior SZ restored with current NIA');
    assert.deepEqual(ret.flags, flags);
    assert.deepEqual(ret.cr, context,
        'Lambda RETURN preserves ALL descriptors and M bits; no CR6 reconstruction');
    const withoutGC = words => words.map((word, i) =>
        i % 4 === 1 ? (word & ~0x40000000) >>> 0 : word);
    assert.deepEqual(withoutGC(Array.from(ret.memory.slice(ret.NS_TABLE_BASE,
        ret.NS_TABLE_BASE + ret.nsCount * 4))), withoutGC(namespace),
    'Namespace authority unchanged apart from native mLoad G-bit marking');
    for (const reg of [8, 9, 10]) {
        assert.notEqual(ret.cr[reg].word0, 0,
            'Lambda RETURN preserves private authority for every mask');
    }
}
console.log('PASS: native zeroing and exact-slot write/read-back fragments');
console.log('PASS: native SZ=0 RETURN resumes the saved context and preserves ALL CRs.');
console.log('PASS: TPERM CLEAR is a test, not erasure; only CALL-frame RETURN masks supply erasure.');
console.log('PASS: native label-bound LAMBDA enters its body and returns, without changing instruction encoding.');
// The all-ones comparison is CLOOMC, not a host predicate or forged success
// response. Its reference is written through Mint's own RW view and loaded
// through its separate L view. The caller cannot choose the reference.
const escapeText = fragment('create_data_passkey_escape', 'create_data_scalar_checks');
const escapeStops = [...new Set([...escapeText.matchAll(/\bTODO_CREATE_\w+/g)].map(m => m[0]))];
for (const stateWords of [64, 256]) for (const credential of [0xffffffff, 0xfffffffe, 0x06000000, 0]) {
    const {s, labels} = fixture(escapeText + '\ncreate_data_scalar_checks:\nHALT\n' +
        escapeStops.map(name => `${name}:\nHALT`).join('\n'), stateWords);
    const header = s.parseLumpHeader(s.memory[CODE]);
    s.memory[CODE] = s.packLumpHeader(2, header.cw, 3, 0);
    s.memory[DATA] = s.packLumpHeader(Math.log2(stateWords) - 6, 0, 1, 0);
    s.cr[6].word1 = CODE + 253;
    s.memory[CODE + 253] = s.cr[6].word0;
    s.memory[CODE + 254] = s.cr[8].word0;
    s.memory[CODE + 255] = s.createGT(0, 41, {L: 1}, 1);
    s.cr[2] = {word0: credential, word1: 0, word2: 0, word3: 0, m: 0};
    s.cr[3] = {word0: 0, word1: 0, word2: 0, word3: 0, m: 0};
    s.cr[4] = {word0: 0, word1: 0, word2: 0, word3: 0, m: 0};
    let steps = 0;
    while (!s.halted && s.pc !== labels.create_data_scalar_checks && steps++ < 40) s.step();
    if (credential === 0xffffffff) {
        assert.equal(s.halted, false, JSON.stringify(s.faultLog));
        assert.equal(s.pc, labels.create_data_scalar_checks);
        assert.equal(s.cr[11].word0 >>> 0, 0xffffffff);
        assert.equal(s.cr[3].word0, 0, 'Escape must not need a proof capability');
        assert.equal(s.mLoad(credential, 'R', 2).ok, false, 'Escape is not memory authority');
    } else {
        assert.notEqual(s.pc, labels.create_data_scalar_checks,
            'A non-escape credential without proof must not pass');
    }
}
console.log('PASS: only CR2=0xFFFFFFFF skips the proof checks, without granting memory authority.');
require('./test_mint_allocator_descriptor');
require('./test_factory_branch_encoding');
require('./test_compact_clist_mutation');
console.log('BLOCKED: saved-design provisioning, Namespace publication and issuance remain incomplete. No complete CREATE claim.');
