'use strict';
// Synthetic component investigation, NOT Mint implementation/provisioning.
// Every descriptor, alias and initial CR below is TEST PRIVILEGE. In particular,
// installing the result view in CR6 does not establish a legal Mint scope switch.
// No gate is mocked; no file, saved image, service, network or hardware is used.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Simulator = require('../../simulator/simulator.js');

const BASE = 0x2000, CELL = BASE + 63, OBJECT = 0x3000;
const SLOT = { list: 40, word: 41, broad: 42, other: 43, object: 44 };
const THREAD_HEADER = 0xf900820c;
// Synthetic 64-word ordinary LUMP, cw=1, typ=00, cc=2:
// row 0 SELF remains intact, row 1 is the sole result. Not a canonical artifact.
const LIST_HEADER = 0xf8000402;
const cap = (word0, word1, word2) => ({word0, word1, word2, word3: 0, m: 0});
function gt(s, slot, rights, seq = 0) {
    return s.createGT(seq, slot, Object.fromEntries([...rights].map(p => [p, 1])), 1);
}
function install(s, reg, slot, rights, location) {
    const e = s.readNSEntry(slot);
    s.cr[reg] = cap(gt(s, slot, rights), location ?? e.word0_location, e.word1_limit);
}
function fixture() {
    const s = new Simulator();
    s.withNamespaceWrite('TEST PRIVILEGE: isolated M3 aliases', () => {
        s.writeNSEntry(1, 0, 255, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(SLOT.list, BASE, 63, 0, 0, 1, 0, 2, 0);
        s.writeNSEntry(SLOT.word, CELL, 0, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(SLOT.broad, BASE, 127, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(SLOT.other, BASE + 128, 15, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(SLOT.object, OBJECT, 15, 0, 0, 1, 0, 0, 0);
    });
    s.memory[0] = THREAD_HEADER;
    s.memory[BASE] = LIST_HEADER;
    s.memory[CELL - 1] = gt(s, SLOT.list, 'E');
    s.cr[12] = cap(0x02000001, 0, 255);
    install(s, 8, SLOT.list, 'L');
    install(s, 9, SLOT.word, 'RW');
    install(s, 10, SLOT.broad, 'RW');
    install(s, 11, SLOT.other, 'RW');
    s.bootComplete = true;
    s.mElevation = false;
    s.petNameMemory.clear(); // no unresolved-name scheduling in this fixture
    s.programCapabilities = null;
    return s;
}
function store(s, value, reg = 9, offset = 0) {
    s.dr[2] = value >>> 0; // input data, never a result CR assignment
    return s._execDwrite({crSrc: reg, crDst: 2, imm: 0x4000 | offset});
}
function read(s, reg = 9, offset = 0) {
    return s._execDread({crSrc: reg, crDst: 3, imm: 0x4000 | offset});
}
function load(s, reg = 8, row = 1) {
    return s._execLoad({crSrc: reg, crDst: 1, imm: row});
}
function scopeForProbe(s) {
    // TEST PRIVILEGE, not a CALL/Lambda/reload implementation.
    install(s, 6, SLOT.list, 'L', CELL - 1);
}
function rejected(s, action, type) {
    const cell = s.memory[CELL], cr1 = {...s.cr[1]};
    assert.equal(action(), null);
    assert.equal(s.faultLog.at(-1).type, type);
    assert.equal(s.halted, true);
    assert.equal(s.memory[CELL], cell);
    assert.deepEqual(s.cr[1], cr1);
}

test('separate word RW and L views pass mLoad; mixed-domain GT does not', () => {
    const s = fixture();
    assert.equal(s.parseLumpHeader(LIST_HEADER).valid, true);
    assert.equal(s.parseLumpHeader(LIST_HEADER).typ, 0);
    assert.equal(s.parseLumpHeader(LIST_HEADER).lumpSize, 64);
    assert.equal(s.parseLumpHeader(LIST_HEADER).cc, 2);
    assert.equal(s.mLoad(s.cr[9].word0, 'W', 9, CELL).ok, true);
    assert.equal(s.mLoad(s.cr[8].word0, 'L', 8, CELL).ok, true);
    assert.equal(s.mLoad((s.cr[9].word0 | 0x08000000) >>> 0, 'W', 9, CELL).fault,
        'DOMAIN_PURITY');
});

test('word bounds deny next-word and previous-word writes before mutation', () => {
    let s = fixture();
    const next = s.memory[CELL + 1];
    rejected(s, () => store(s, 0xdeadbeef, 9, 1), 'RANGE');
    assert.equal(s.memory[CELL + 1], next);
    s = fixture();
    s.dr[2] = 0xdeadbeef;
    rejected(s, () => s._execDwrite({crSrc: 9, crDst: 2, imm: 0, idx1Offset: -1}), 'RANGE');
    assert.equal(s.memory[CELL - 1], gt(s, SLOT.list, 'E'));
});

test('no view, disjoint view and L-only view cannot DREAD the result', () => {
    for (const [reg, offset, fault] of [[7, 0, 'NULL_CAP'], [11, 16, 'RANGE'],
        [8, 63, 'PERMISSION']]) {
        const s = fixture();
        assert.ok(store(s, gt(s, SLOT.object, 'RW')));
        rejected(s, () => read(s, reg, offset), fault);
        assert.equal(s.dr[3], 0);
    }
});

test('private RW/L views confer no X permission; stale source view cannot write', () => {
    const s = fixture();
    for (const reg of [8, 9]) {
        assert.equal(s.mLoad(s.cr[reg].word0, 'X', reg, CELL).fault, 'PERMISSION');
    }
    s.cr[9].word0 = gt(s, SLOT.word, 'RW', 1);
    rejected(s, () => store(s, 123), 'VERSION');
});

test('non-CR6 L-only LOAD delivers usable authority without granting R', () => {
    const s = fixture(), result = gt(s, SLOT.object, 'RW');
    const source = {...s.cr[8]};
    assert.ok(store(s, result));
    assert.ok(load(s));
    assert.equal(s.cr[1].word0, result);
    assert.deepEqual(s.cr[8], source);
    assert.ok(store(s, 0xaabbccdd, 1));
    assert.equal(s.memory[OBJECT], 0xaabbccdd);
    rejected(s, () => read(s, 8, 0), 'PERMISSION');
});

test('non-CR6 R-only and E-only LOAD fail L; mixed is invalid', () => {
    for (const [rights, type] of [['E', 'PERMISSION'], ['R', 'PERMISSION']]) {
        const s = fixture();
        assert.ok(store(s, gt(s, SLOT.object, 'RW')));
        install(s, 8, SLOT.list, rights);
        rejected(s, () => load(s), type);
    }
    const s = fixture();
    s.cr[8].word0 |= 0x20000000; // raw malformed R+L, NOT a provisioning option
    rejected(s, () => load(s), 'DOMAIN_PURITY');
});

test('CR6 E-only LOAD requires its register M bit and preserves its GT', () => {
    for (const m of [0, 1]) {
        const s = fixture(), result = gt(s, SLOT.object, 'RW');
        assert.ok(store(s, result));
        scopeForProbe(s);
        s.cr[6].word0 = gt(s, SLOT.list, 'E');
        s.cr[6].m = m;
        const source = {...s.cr[6]};
        if (m) {
            assert.ok(load(s, 6));
            assert.equal(s.cr[1].word0, result);
        } else {
            rejected(s, () => load(s, 6), 'PERMISSION');
        }
        assert.deepEqual(s.cr[6], source);
    }
});

test('L-only LOAD retains source generation, seal, header and row bounds checks', () => {
    for (const failure of ['generation', 'seal', 'header', 'row', 'null', 'mixed']) {
        const s = fixture();
        assert.ok(store(s, gt(s, SLOT.object, 'RW')));
        if (failure === 'generation') s.cr[8].word0 = gt(s, SLOT.list, 'L', 1);
        if (failure === 'seal') {
            const e = s.readNSEntry(SLOT.list);
            // Alter physical W2 without recomputing integrity.
            s.memory[s._nsSlotBase(SLOT.list) + 2] ^= 1;
            assert.notEqual(s.readNSEntry(SLOT.list).word2_seals, e.word2_seals);
        }
        if (failure === 'header') s.cr[8].word1 = BASE - 1;
        if (failure === 'null') s.memory[CELL] = 0;
        if (failure === 'mixed') s.memory[CELL] = (gt(s, SLOT.object, 'RW') | 0x08000000) >>> 0;
        const fault = {generation:'VERSION', seal:'SEAL', header:'RANGE',
            row:'NO_CAPABILITY', null:'NULL_CAP', mixed:'DOMAIN_PURITY'}[failure];
        rejected(s, () => load(s, 8, failure === 'row' ? 2 : 1), fault);
        assert.equal(s.cr[1].word0, 0);
    }
});

test('assembled LOAD then DWRITE retire using an ordinary L-only source', () => {
    const Assembler = require('../../simulator/assembler.js');
    const compiled = new Assembler().assemble('LOAD CR1, CR8, #1\nDWRITE DR2, CR1, #0');
    assert.deepEqual(compiled.errors, []);
    const s = fixture(), result = gt(s, SLOT.object, 'RW'), codeBase = 0x4000;
    s.withNamespaceWrite('TEST PRIVILEGE: private instruction fixture', () =>
        s.writeNSEntry(45, codeBase, 63, 0, 0, 1, 0, 0, 0));
    install(s, 14, 45, 'X');
    s.memory[codeBase] = 0xf8000800; // cw=2, cc=0
    s.pc = 0;
    const fetch = s._fetchInstruction();
    assert.ok(fetch.ok);
    s.memory.set(compiled.words, fetch.addr);
    s.memory[CELL] = result; // fixture input, not a result-register shortcut
    s.dr[2] = 0x1234abcd;
    s.halted = false;
    const source = {...s.cr[8]};
    const first = s.step();
    assert.ok(first);
    assert.equal(first.instr.opcode, 0);
    assert.equal(s.cr[1].word0, result);
    const second = s.step();
    assert.ok(second);
    assert.equal(second.instr.opcode, 17);
    assert.equal(s.memory[OBJECT], 0x1234abcd);
    assert.deepEqual(s.cr[8], source);
    assert.equal(s.faultLog.length, 0);
});

test('CR6 test scope LOAD materializes B=0 result; no invocation/publication needed', () => {
    const s = fixture(), result = gt(s, SLOT.object, 'RW');
    assert.equal(s.parseGT(result).permissions.B, 0);
    assert.ok(store(s, result)); // no BEGIN, publication, verifier or permit exists
    scopeForProbe(s);
    assert.ok(load(s, 6));
    assert.equal(s.cr[1].word0, result);
    assert.equal(s.cr[1].word1, OBJECT);
    assert.ok(store(s, 0xaabbccdd, 1)); // actually use the manufactured authority
    assert.equal(s.memory[OBJECT], 0xaabbccdd);
});

test('B=0 result still fails ordinary SAVE export', () => {
    const s = fixture();
    assert.ok(store(s, gt(s, SLOT.object, 'RW')));
    scopeForProbe(s);
    assert.ok(load(s, 6));
    assert.equal(s._execSave({crSrc: 6, crDst: 1, imm: 1}), null);
    assert.equal(s.faultLog.at(-1).type, 'BIND');
});

test('CR6 row bounds, malformed and NULL result GTs remain rejected', () => {
    for (const [kind, fault] of [['row', 'NO_CAPABILITY'], ['mixed', 'DOMAIN_PURITY'],
        ['null', 'NULL_CAP']]) {
        const s = fixture();
        let value = gt(s, SLOT.object, 'RW');
        if (kind === 'mixed') value |= 0x08000000;
        if (kind === 'null') value = 0;
        assert.ok(store(s, value));
        scopeForProbe(s);
        rejected(s, () => load(s, 6, kind === 'row' ? 2 : 1), fault);
    }
});

test('stale result materializes through Inform LOAD but faults on actual memory use', () => {
    const s = fixture(), stale = gt(s, SLOT.object, 'RW', 1);
    assert.ok(store(s, stale));
    scopeForProbe(s);
    assert.ok(load(s, 6)); // source-view version checked, target version not here
    assert.equal(s.cr[1].word0, stale);
    const before = s.memory[OBJECT];
    rejected(s, () => store(s, 123, 1), 'VERSION');
    assert.equal(s.memory[OBJECT], before);
});
test('bad descriptor seal blocks LOAD of an otherwise well-formed result', () => {
    const s = fixture();
    assert.ok(store(s, gt(s, SLOT.object, 'RW')));
    s.memory[s._nsSlotBase(SLOT.object) + 2] ^= 1; // test-side corruption
    scopeForProbe(s);
    rejected(s, () => load(s, 6), 'SEAL');
});

test('early, duplicate, arbitrary-value and alternate-target writes are accepted', () => {
    const s = fixture();
    const result = gt(s, SLOT.object, 'RW'), other = gt(s, SLOT.other, 'RW');
    for (const value of [result, result, 0xdeadbeef, other, 0, result]) {
        assert.ok(store(s, value));
        assert.equal(s.memory[CELL], value >>> 0);
    }
    assert.ok(store(s, other));
    scopeForProbe(s);
    assert.ok(load(s, 6));
    assert.equal(s.cr[1].word0, other);
});

test('LOAD is not consuming: same result can be loaded twice until cleared', () => {
    const s = fixture(), result = gt(s, SLOT.object, 'RW');
    assert.ok(store(s, result));
    scopeForProbe(s);
    assert.ok(load(s, 6));
    assert.ok(load(s, 6));
    assert.equal(s.memory[CELL], result);
    assert.ok(store(s, 0));
    rejected(s, () => load(s, 6), 'NULL_CAP');
    // A failed new load does not erase the preceding CR1 result.
    assert.equal(s.cr[1].word0, result);
});

test('overlapping RW alias reads and rewrites result and adjacent framing', () => {
    const s = fixture(), result = gt(s, SLOT.object, 'RW');
    assert.ok(store(s, result));
    assert.ok(read(s, 10, 63));
    assert.equal(s.dr[3], result);
    assert.ok(store(s, 0xcafebabe, 10, 62));
    assert.equal(s.memory[CELL - 1], 0xcafebabe);
    assert.ok(store(s, gt(s, SLOT.other, 'R'), 10, 63));
    scopeForProbe(s);
    assert.ok(load(s, 6));
    assert.equal(s.cr[1].word0, gt(s, SLOT.other, 'R'));
});

for (const phase of ['before-write', 'after-write', 'after-load', 'after-clear']) {
    test(`fault ${phase}: halts, does not sanitize retained authority/evidence`, () => {
        const s = fixture(), result = gt(s, SLOT.object, 'RW');
        scopeForProbe(s);
        if (phase !== 'before-write') assert.ok(store(s, result));
        if (phase === 'after-load' || phase === 'after-clear') assert.ok(load(s, 6));
        if (phase === 'after-clear') assert.ok(store(s, 0));
        let observed;
        s.on('fault', event => { observed = event; });
        s.fault('INVALID_OP', `isolated fault injection ${phase}`);
        const expected = ['after-write', 'after-load'].includes(phase) ? result : 0;
        assert.equal(s.memory[CELL], expected);
        // Static-image serialization is not a general confidentiality boundary:
        // it excludes these runtime writes, while the live and fault views above do not.
        assert.equal(s.snapshotPersistentMemory()[CELL], 0);
        assert.equal(s.halted, true);
        const memory = s.memory.slice(), cr = structuredClone(s.cr), pc = s.pc;
        assert.equal(s.step(), null); // do NOT resume an interrupted call
        assert.deepEqual(s.memory, memory);
        assert.deepEqual(s.cr, cr);
        assert.equal(s.pc, pc);
        assert.equal(observed.crSnapshot[9].word0, s.cr[9].word0);
        assert.equal(observed.crSnapshot[8].word0, s.cr[8].word0);
        assert.equal(s.getState().cr[9].word0, s.cr[9].word0);
        if (phase === 'after-load' || phase === 'after-clear') {
            assert.equal(observed.crSnapshot[1].word0, result);
            assert.equal(s.memory[245], result); // Thread c-list CR1 home (244+1)
            assert.equal(s.getState().cr[1].word0, result);
        }
    });
}

test('return-to-boot keeps cell, Thread result home, diagnostics and writable alias descriptor', () => {
    const s = fixture(), result = gt(s, SLOT.object, 'RW');
    assert.ok(store(s, result));
    scopeForProbe(s);
    assert.ok(load(s, 6));
    s.fault('INVALID_OP', 'isolated reset boundary');
    const oldFault = s.faultLog.at(-1);
    s._returnToBoot('isolated M3 recovery-reset inspection');
    assert.equal(s.memory[CELL], result);
    assert.equal(s.memory[245], result);
    assert.equal(s.cr[1].word0, 0);
    assert.equal(s.cr[9].word0, 0);
    assert.equal(s.faultLog.at(-1), oldFault);
    assert.equal(oldFault.crSnapshot[1].word0, result);
    assert.equal(s.mLoad(gt(s, SLOT.word, 'RW'), 'R', 9, CELL).ok, true);
    // New synthetic context, NOT resumption, legal provisioning or actual boot.
    s.bootComplete = true;
    s.cr[12] = cap(0x02000001, 0, 255);
    scopeForProbe(s);
    assert.ok(load(s, 6));
    assert.equal(s.cr[1].word0, result); // old result can be redelivered
});

test('full reset replaces live RAM/CRs but cannot erase an emitted fault snapshot', () => {
    const s = fixture(), result = gt(s, SLOT.object, 'RW');
    assert.ok(store(s, result));
    scopeForProbe(s);
    assert.ok(load(s, 6));
    let emitted;
    s.on('fault', event => { emitted = event; });
    s.fault('INVALID_OP', 'isolated full reset');
    s.reset('isolated M3 full reset');
    assert.equal(s.memory[CELL], 0);
    assert.equal(s.memory[245], 0);
    assert.equal(s.cr[1].word0, 0);
    assert.equal(s.faultLog.length, 0);
    assert.equal(emitted.crSnapshot[1].word0, result);
    assert.notEqual(emitted.crSnapshot[9].word0, 0);
    const resetEvent = s.getControlFlowDiagnostics().events.at(-1);
    assert.equal(resetEvent.kind, 'RESET');
    assert.equal(resetEvent.descriptors.cr6.word0, gt(s, SLOT.list, 'L'));
});

test('explicit cell+CR clear removes live copies, not prior diagnostic evidence', () => {
    const s = fixture(), result = gt(s, SLOT.object, 'RW');
    assert.ok(store(s, result));
    scopeForProbe(s);
    assert.ok(load(s, 6));
    const observed = s.getState();
    assert.ok(store(s, 0));
    for (const reg of [1, 6, 8, 9, 10]) s._clearCR(reg); // test-only cleanup
    assert.equal(s.memory[CELL], 0);
    assert.equal(s.memory[245], 0);
    assert.equal(s.cr[9].word0, 0);
    assert.equal(observed.cr[1].word0, result);
    assert.notEqual(observed.cr[9].word0, 0);
});
