'use strict';
// Historical filename retained for the configured validation command.
// Ordinary RETURN retains E authority; register M, not L token rewriting,
// grants c-list LOAD access.
const assert = require('node:assert/strict');
const {fixture, checkContext, reject} = require('./cr6_contract_fixture');

// Compile all three domains. Execute actual CALL/RETURN/LOAD instructions
// through protected Thread frames and the lump-only adapter, without moving
// CR14 or substituting code between steps.
for (const protectedThread of [false, true]) {
    const {sim, compile, activate} = fixture(protectedThread);
    const leaf = compile(32, 'IADD DR1, DR0, #42\nRETURN');
    const middle = compile(31,
        'LOAD CR1, CR6, #1\nCALL CR1, #0\nLOAD CR2, CR6, #1\nRETURN', [leaf.gt]);
    const outer = compile(30,
        'LOAD CR1, CR6, #1\nCALL CR1, #0\nLOAD CR2, CR6, #1\nHALT', [middle.gt]);
    activate(outer);
    sim.pc = 1; // Enter Run after its method-table word; nested calls use selector 1.
    const startSTO = sim.sto;
    const heap = {...sim.cr[5], m: 0};
    const cr13 = {...sim.cr[13], m: 0};
    const domains = [outer, middle, leaf];
    const events = [];
    let maxDepth = sim.callStack.length;
    const initialDepth = maxDepth;
    for (let budget = 60; !sim.halted && budget > 0; budget--) {
        const before = domains.find(d => d.base === sim.cr[14].word1);
        assert(before, 'must execute one of the compiled domains');
        const oldGT = sim.cr[6].word0;
        const oldSTO = sim.sto;
        const result = sim.step();
        if (sim.halted) {
            assert.equal(result?.desc, `HALT at 0x${(outer.base + 5).toString(16).toUpperCase()}`);
            break;
        }
        assert(result && result.instr && !result.skipped);
        const op = result.instr.opcode;
        const current = domains.find(d => d.base === sim.cr[14].word1);
        if ([2, 3].includes(op)) {
            checkContext(sim, current);
            assert.deepEqual(sim.cr[5], heap, 'CR5 descriptor unchanged; M reset');
            assert.deepEqual(sim.cr[13], cr13, 'CR13 descriptor unchanged; M reset');
            events.push({op, from: before.slot, to: current.slot});
        }
        if (op === 2) {
            const frame = sim.callStack.at(-1);
            assert.equal(frame.companionGT, oldGT, 'saved E authority is byte-identical');
            assert.equal(sim.sto, oldSTO - 2, 'CALL still uses a two-word frame');
            if (protectedThread) {
                const base = sim._activeThreadBase();
                assert.equal(sim.memory[base + oldSTO - 1], oldGT);
                assert.equal(sim.memory[base + oldSTO], frame.frameWord);
            }
        }
        if (op === 0) {
            assert.equal(sim.cr[6].word0, oldGT, 'LOAD cannot mutate E authority');
            if (result.instr.crDst === 2) {
                assert.equal(sim.cr[2].word0, before === middle ? leaf.gt : middle.gt,
                    'post-return LOAD reads the caller c-list');
                events.push({op, from: before.slot});
            }
        }
        maxDepth = Math.max(maxDepth, sim.callStack.length);
    }
    assert(sim.halted, 'compiled program must finish');
    assert.equal(maxDepth, initialDepth + 2, 'two nested ordinary CALL frames');
    assert.equal(sim.sto, startSTO);
    assert.equal(sim.callStack.length, initialDepth);
    assert.equal(sim.dr[1], 42);
    assert.deepEqual(events, [
        {op: 2, from: 30, to: 31}, {op: 2, from: 31, to: 32},
        {op: 3, from: 32, to: 31}, {op: 0, from: 31},
        {op: 3, from: 31, to: 30}, {op: 0, from: 30},
    ]);
    checkContext(sim, outer);

    // M=0 rejects the same post-return E GT, before any destination write.
    sim.halted = false;
    sim.cr[6].m = 0;
    const destination = {...sim.cr[3]};
    reject(sim, () => sim._execLoad({crDst: 3, crSrc: 6, imm: 1}), 'PERMISSION');
    assert.deepEqual(sim.cr[3], destination);
    assert.equal(sim.cr[6].word0, outer.gt);
    sim.cr[6].m = 1;
    assert(sim._execLoad({crDst: 3, crSrc: 6, imm: 1}));
    assert.equal(sim.cr[3].word0, middle.gt);
}

// Keep mask prevents clearing current descriptors; 5/6 are ignored, and all
// M bits reset before CR6.M is rearmed. Cover the adapter as well as real RAM.
for (const protectedThread of [false, true]) {
    for (const mask of [0, 1 << 6, 0xFFF]) {
        const {sim, install, activate} = fixture(protectedThread);
        const code = [sim.encodeInstruction(23, 14, 0, 0, 1),
            sim.encodeInstruction(3, 14, 0, 0, mask)];
        const caller = install(30, code);
        const callee = install(31, code);
        activate(caller);
        sim.cr[0].word0 = callee.gt;
        const heap = {...sim.cr[5], m: 0};
        const cr13 = {...sim.cr[13], m: 0};
        assert(sim._execCall({crDst: 0, imm: 0}));
        // Diagnostic snapshots are not caller authority. Even the lump-only
        // adapter must use its validated Enter companion and Namespace view.
        sim.callStack.at(-1).savedCRs[6] = {
            word0: sim.createGT(0, callee.slot, {L: 1}, 1),
            word1: callee.base, word2: 0, word3: 0, m: 0,
        };
        for (const i of [0, 1, 2, 3, 4, 7, 8, 9, 10, 11])
            sim.cr[i] = {word0: callee.gt, word1: callee.base, word2: 2, word3: 3, m: 1};
        const current = sim.cr.map(c => ({...c}));
        assert.equal(sim.pc, 0, 'selector zero enters the first code word');
        assert.equal(sim.step().instr.opcode, 23, 'retire the entry branch');
        assert(sim.step());
        checkContext(sim, caller);
        for (const i of [0, 1, 2, 3, 4, 7, 8, 9, 10, 11])
            assert.deepEqual(sim.cr[i], mask & (1 << i) ? {...current[i], m: 0}
                : {word0: 0, word1: 0, word2: 0, word3: 0, m: 0});
        assert.deepEqual(sim.cr[5], heap);
        assert.deepEqual(sim.cr[13], cr13);
    }
}
// M bypasses only L permission, never identity/type/generation/integrity gates.
for (const protectedThread of [false, true]) {
    for (const gate of ['type', 'generation', 'seal']) {
        const {sim, install, activate} = fixture(protectedThread);
        const code = [sim.encodeInstruction(23, 14, 0, 0, 1),
            sim.encodeInstruction(3, 14, 0, 0, 0)];
        const callee = install(31, code);
        const caller = install(30, code, [callee.gt]);
        activate(caller);
        sim.cr[0].word0 = callee.gt;
        assert(sim._execCall({crDst: 0, imm: 0}));
        assert.equal(sim.step().instr.opcode, 23, 'retire selector-zero entry branch');
        assert(sim.step());
        checkContext(sim, caller);
        if (gate === 'type') {
            sim.cr[6].word0 &= ~(3 << 25);
            assert.equal(sim.mLoad(sim.cr[6].word0, null, 6).fault, 'NULL_CAP');
        }
        if (gate === 'generation') sim.cr[6].word0 ^= 1 << 16;
        if (gate === 'seal') sim.memory[sim._nsSlotBase(caller.slot) + 2] ^= 1;
        const destination = {...sim.cr[3]};
        const word = sim.cr[6].word0;
        reject(sim, () => sim._execLoad({crDst: 3, crSrc: 6, imm: 1}),
            // LOAD's c-list-count check sees a NULL type as zero rows before
            // reaching mLoad; both gates must still reject it with M set.
            {type: 'NO_CAPABILITY', generation: 'VERSION', seal: 'SEAL'}[gate]);
        assert.deepEqual(sim.cr[3], destination);
        assert.equal(sim.cr[6].word0, word);
    }

    // A saved E token is authority, not permission to mint a current version.
    for (const gate of ['type', 'generation', 'seal']) {
        const {sim, install, activate} = fixture(protectedThread);
        const code = [sim.encodeInstruction(23, 14, 0, 0, 1),
            sim.encodeInstruction(3, 14, 0, 0, 0)];
        const caller = install(30, code), callee = install(31, code);
        activate(caller);
        sim.cr[0].word0 = callee.gt;
        assert(sim._execCall({crDst: 0, imm: 0}));
        const frame = sim.callStack.at(-1);
        let companion = caller.gt;
        if (gate === 'type') companion = sim.createGT(0, caller.slot, {E: 1}, 3);
        if (gate === 'generation') companion ^= 1 << 16;
        if (gate === 'seal') sim.memory[sim._nsSlotBase(caller.slot) + 2] ^= 1;
        if (protectedThread) sim.memory[sim._activeThreadBase() + frame.savedSTO - 1] = companion;
        else frame.companionGT = companion;
        const cr6 = {...sim.cr[6]}, sto = sim.sto, depth = sim.callStack.length;
        reject(sim, () => sim._execReturn({imm: 0}),
            gate === 'type' ? (protectedThread ? 'PERM_E' : 'TYPE')
                : gate === 'generation' ? 'VERSION' : 'SEAL');
        assert.deepEqual(sim.cr[6], cr6, 'failed RETURN cannot install caller authority');
        assert.equal(sim.sto, sto);
        assert.equal(sim.callStack.length, depth);
    }

    // CALL must not silently refresh a stale caller identity for the frame.
    {
        const {sim, install, activate} = fixture(protectedThread);
        const code = [sim.encodeInstruction(23, 14, 0, 0, 1),
            sim.encodeInstruction(3, 14, 0, 0, 0)];
        const caller = install(30, code), callee = install(31, code);
        activate(caller);
        sim.cr[6].word0 ^= 1 << 16;
        sim.cr[0].word0 = callee.gt;
        const sto = sim.sto, depth = sim.callStack.length;
        reject(sim, () => sim._execCall({crDst: 0, imm: 0}), 'VERSION');
        assert.equal(sim.sto, sto);
        assert.equal(sim.callStack.length, depth);
    }
}
console.log('PASS nested compiled CALL/RETURN: exact E GT, frame authority, c-list LOAD, M gate and keep masks');

// A real Thread must never turn L/RX/no-rights caller tokens into Enter
// authority, even when CR6.M is set or the whole machine is elevated.
for (const rights of [{L: 1}, {R: 1, X: 1}, {}]) {
    for (const elevated of [0, 1]) {
        const {sim, install, activate} = fixture(true);
        const code = [sim.encodeInstruction(23, 14, 0, 0, 1),
            sim.encodeInstruction(3, 14, 0, 0, 0)];
        const caller = install(30, code), callee = install(31, code);
        activate(caller);
        sim.cr[6].word0 = sim.createGT(sim.parseGT(caller.gt).gt_seq, caller.slot, rights, 1);
        sim.cr[0].word0 = callee.gt;
        sim.mElevation = elevated;
        const base = sim._activeThreadBase();
        const layout = sim._threadLayoutAtBase(base);
        const words = sim.memory.slice(base, base + layout.lumpSize);
        const cr6 = {...sim.cr[6]}, sto = sim.sto, depth = sim.callStack.length;
        reject(sim, () => sim._execCall({crDst: 0, imm: 0}), 'PERM_E');
        assert.deepEqual(sim.cr[6], cr6);
        assert.equal(sim.sto, sto);
        assert.equal(sim.callStack.length, depth);
        assert.deepEqual(sim.memory.slice(base, base + layout.lumpSize), words,
            'rejected authority cannot publish a protected frame');
    }
}

// B is object-lock metadata, not an optional decoration. Preserve every bit
// of valid E authority in CR6, the protected companion, and RETURN.
for (const protectedThread of [false, true]) {
    const {sim, install, activate} = fixture(protectedThread);
    const code = [sim.encodeInstruction(23, 14, 0, 0, 1),
        sim.encodeInstruction(3, 14, 0, 0, 0)];
    const caller = install(30, code), callee = install(31, code);
    caller.gt = (caller.gt | 0x80000000) >>> 0;
    callee.gt = (callee.gt | 0x80000000) >>> 0;
    activate(caller);
    sim.cr[0].word0 = callee.gt;
    assert(sim._execCall({crDst: 0, imm: 0}));
    checkContext(sim, callee);
    const frame = sim.callStack.at(-1);
    assert.equal(frame.companionGT, caller.gt);
    if (protectedThread)
        assert.equal(sim.memory[sim._activeThreadBase() + frame.savedSTO - 1], caller.gt);
    assert.equal(sim.step().instr.opcode, 23, 'retire selector-zero entry branch');
    assert(sim.step());
    checkContext(sim, caller);
}

// SZ=0 is not a CALL boundary: preserve CR6, including a cleared M bit.
for (const protectedThread of [false, true]) {
    const {sim, install, activate} = fixture(protectedThread);
    const domain = install(30, [0, sim.encodeInstruction(3, 14, 0, 0, 0)]);
    activate(domain);
    const sto = sim.sto;
    assert(sim._execLambda({crDst: 14}));
    assert.equal(sim.sto, sto - 1);
    sim.cr[6].m = 0;
    const currentCRs = sim.cr.map(cr => ({...cr}));
    assert(sim.step());
    assert.deepEqual(sim.cr, currentCRs);
    assert.equal(sim.cr[14].word1, domain.base);
    assert.equal(sim.sto, sto);
}
