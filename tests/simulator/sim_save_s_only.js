'use strict';
// Isolated instruction fixture, following mint_phase1/result_containment_probe.js.
// Namespace/CR setup is TEST PRIVILEGE, not functional Mint or legal provisioning.
// No saved LUMP, live Namespace, service, hardware, or validation gate is replaced.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Simulator = require('../../simulator/simulator.js');
const Assembler = require('../../simulator/assembler.js');

const BASE = 0x2000, CELL = BASE + 63, OBJECT = 0x3000, CODE = 0x4000;
const SLOT = { list: 40, object: 41, code: 42 };
const cap = (word0, word1, word2) => ({ word0, word1, word2, word3: 0, m: 0 });
function gt(s, slot, rights, seq = 0) {
    return s.createGT(seq, slot, Object.fromEntries([...rights].map(p => [p, 1])), 1) >>> 0;
}
function install(s, reg, slot, rights, location) {
    const e = s.readNSEntry(slot);
    s.cr[reg] = cap(gt(s, slot, rights), location ?? e.word0_location, e.word1_limit);
}
function fixture(source = 'SAVE CR1, CR8, #1') {
    const compiled = new Assembler().assemble(source);
    assert.deepEqual(compiled.errors, []);
    const s = new Simulator();
    s.withNamespaceWrite('TEST PRIVILEGE: isolated SAVE instruction inputs', () => {
        s.writeNSEntry(1, 0, 255, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(SLOT.list, BASE, 63, 0, 0, 1, 0, 2, 0);
        s.writeNSEntry(SLOT.object, OBJECT, 15, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(SLOT.code, CODE, 63, 0, 0, 1, 0, 0, 0);
    });
    s.memory[0] = 0xf900820c; // Thread for real fault capture, not mocked fault().
    s.memory[BASE] = 0xf8000402; // ordinary 64-word LUMP, cw=1, cc=2
    s.memory[CELL - 1] = gt(s, SLOT.list, 'E'); // compiler-owned SELF
    s.memory[CELL] = gt(s, SLOT.object, 'R'); // sentinel to detect rejected writes
    s.cr[12] = cap(0x02000001, 0, 255);
    install(s, 1, SLOT.object, 'EB'); // legitimately bindable, domain-pure input GT
    install(s, 8, SLOT.list, 'S');
    install(s, 9, SLOT.list, 'L');
    install(s, 14, SLOT.code, 'X');
    s.memory[CODE] = (0xf8000000 | (compiled.words.length << 10)) >>> 0;
    s.bootComplete = true; // ordinary instruction path, outside reset privileges
    s.mElevation = false;
    s.petNameMemory.clear();
    s.programCapabilities = null;
    s.pc = 0;
    const fetch = s._fetchInstruction();
    assert.ok(fetch.ok);
    s.memory.set(compiled.words, fetch.addr);
    s.halted = false;
    return s;
}
function reject(s, fault, sourceReg = 1) {
    const before = s.memory.slice(BASE, CELL + 2);
    const source = { ...s.cr[sourceReg] }, view = { ...s.cr[8] };
    const pc = s.pc;
    let captured;
    s.on('fault', event => { captured = event; });
    s.step();
    assert.equal(s.faultLog.at(-1)?.type, fault);
    assert.equal(s.halted, true);
    assert.ok(captured, 'real pre-recovery fault evidence');
    assert.deepEqual(s.memory.slice(BASE, CELL + 2), before, 'no c-list/header/neighbor write');
    assert.deepEqual(captured.crSnapshot[sourceReg], source, 'source GT and M preserved');
    assert.deepEqual(captured.crSnapshot[8], view, 'c-list view unchanged');
    assert.equal(s.pc, pc, 'faulting SAVE did not retire');
}

test('assembled non-CR6 S-only SAVE retires and L-only LOAD reads back the exact GT', () => {
    const s = fixture('SAVE CR1, CR8, #1\nLOAD CR2, CR9, #1');
    const source = { ...s.cr[1] }, view = { ...s.cr[8] };
    const before = s.memory.slice(BASE, CELL);
    assert.equal(s.parseGT(view.word0).permissions.S, 1);
    assert.equal(s.parseGT(view.word0).permissions.R, 0);
    assert.equal(s.parseGT(source.word0).permissions.B, 1);
    assert.equal(s.cr[6].m, 0);
    const saved = s.step();
    assert.ok(saved, JSON.stringify(s.faultLog.at(-1)));
    assert.equal(saved.instr.opcode, 1);
    assert.equal(s.pc, 1);
    assert.equal(s.memory[CELL], source.word0);
    assert.deepEqual(s.memory.slice(BASE, CELL), before, 'SELF and all other words preserved');
    assert.deepEqual(s.cr[1], source);
    assert.deepEqual(s.cr[8], view);
    const reads = s.auditLog.filter(a => a.gate === 'mLoad' && a.nsIndex === SLOT.list);
    assert.deepEqual(reads.map(a => a.requiredPerm), ['S', 'S']);
    assert.equal(reads[0].checks.range.address, BASE);
    assert.equal(reads[1].checks.range.address, CELL);
    assert.ok(s.step());
    assert.equal(s.cr[2].word0, source.word0);
    assert.equal(s.pc, 2);
    assert.equal(s.faultLog.length, 0);
});

for (const rights of ['R', 'E', 'L']) {
    test(`${rights}-only ordinary c-list view cannot SAVE`, () => {
        const s = fixture();
        install(s, 8, SLOT.list, rights);
        reject(s, 'PERMISSION');
        assert.match(s.faultLog.at(-1).message, /lacks S permission/);
    });
}
test('ordinary B=0 export remains denied, even with source register M', () => {
    for (const m of [0, 1]) {
        const s = fixture();
        install(s, 1, SLOT.object, 'E');
        s.cr[1].m = m;
        reject(s, 'BIND');
    }
});
for (const reg of [1, 8]) {
    for (const failure of ['E-with-L', 'E-with-S', 'generation', 'seal', 'bounds', 'null']) {
        test(`${reg === 1 ? 'exported GT' : 'c-list view'} rejects ${failure}`, () => {
            const s = fixture(), slot = reg === 1 ? SLOT.object : SLOT.list;
            // dom selects the meaning of the payload; mixed domains have no raw
            // encoding. E combined with L or S is a malformed Church payload.
            if (failure === 'E-with-L' || failure === 'E-with-S') {
                s.cr[reg].word0 = (gt(s, slot, 'EB') |
                    (failure === 'E-with-L' ? 0x10000000 : 0x20000000)) >>> 0;
                assert.equal(s.parseGT(s.cr[reg].word0).malformed, true);
            }
            if (failure === 'generation') s.cr[reg].word0 = gt(s, slot, reg === 1 ? 'EB' : 'S', 1);
            if (failure === 'seal') s.memory[s._nsSlotBase(slot) + 2] ^= 1;
            if (failure === 'bounds') s.cr[reg].word0 = gt(s, s.nsCount, reg === 1 ? 'EB' : 'S');
            if (failure === 'null') s.cr[reg].word0 = 0;
            reject(s, { 'E-with-L': 'DOMAIN_PURITY', 'E-with-S': 'DOMAIN_PURITY',
                generation: 'VERSION', seal: 'SEAL', bounds: 'BOUNDS', null: 'NULL_CAP' }[failure]);
        });
    }
}
test('header metadata lookup retains descriptor bounds', () => {
    for (const address of [BASE - 1, BASE + 64]) {
        const s = fixture();
        s.cr[8].word1 = address;
        reject(s, 'RANGE');
    }
});
test('row bounds and compact index overflow/underflow reject before writing', () => {
    for (const [operand, dr] of [['#2', 0], ['DR3 + 1', 0xffffffff], ['DR3 - 1', 0]]) {
        const s = fixture(`SAVE CR1, CR8, ${operand}`);
        s.dr[3] = dr;
        reject(s, 'BOUNDS');
        assert.equal(s.dr[3] >>> 0, dr);
    }
});
test('computed SELF row zero wins even over missing source M', () => {
    const s = fixture('SAVE CR13, CR8, DR3 - 1');
    s.dr[3] = 1;
    reject(s, 'IMMUTABLE_SELF_CAP', 13);
});
test('c-list register M does not replace destination S permission', () => {
    const s = fixture();
    install(s, 8, SLOT.list, 'E');
    s.cr[8].m = 1;
    reject(s, 'PERMISSION');
});
test('isolated source requires M, consumes it on success only, and still needs destination S', () => {
    for (const [m, rights, fault] of [[0, 'S', 'PERM_L'], [1, 'E', 'PERMISSION'], [1, 'S', null]]) {
        const s = fixture('SAVE CR13, CR8, #1');
        install(s, 13, SLOT.object, 'E'); // B=0, existing isolated-M export rule
        s.cr[13].m = m;
        install(s, 8, SLOT.list, rights);
        if (fault) reject(s, fault, 13);
        else {
            const source = { ...s.cr[13] }, view = { ...s.cr[8] };
            assert.ok(s.step());
            assert.equal(s.memory[CELL], source.word0);
            assert.deepEqual(s.cr[13], { ...source, m: 0 });
            assert.deepEqual(s.cr[8], view);
            assert.equal(s.faultLog.length, 0);
        }
    }
});
test('S-only metadata authority does not grant a data read', () => {
    const s = fixture('DREAD DR2, CR8, #0');
    reject(s, 'PERMISSION');
    assert.equal(s.dr[2], 0);
});
