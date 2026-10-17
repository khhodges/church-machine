'use strict';

// Private instruction-driven fixtures only. Never touch saved artifacts or
// recover from faults: recovery would replace the evidence under test.
const assert = require('assert');
global.window = {bootConfig: {step1: {
    totalNamespaceWords: 16384, namespaceLumpWords: 1024,
    threadLumpWords: 512, threadCount: 3,
}}};
const Sim = require('./simulator');
global.ChurchAssembler = require('./assembler');
const Compiler = require('./cloomc_compiler');
const {assembleLump} = require('./lump_assembler');
const R = require('./thread-heap-record');
const offset = 10;
const fieldOffset = offset + R.schema.fields.find(f => f.name === 'conditions').offset;
const compiled = new Compiler().compile(R.source(offset), []);
assert.deepStrictEqual(compiled.errors, []);
const assembled = assembleLump(compiled.methods.map(m => m.code));

function runCase(name, authority, methodName, expectedFault) {
    const sim = new Sim();
    for (let i = 0; !sim.bootComplete && !sim.halted && i < 32; i++) sim._bootStep();
    assert(sim.bootComplete && !sim.halted, name);
    const threads = sim.configuredThreadSlots().map(slot => {
        const base = sim.readNSEntry(slot).word0_location;
        return {slot, base, layout: sim._threadLayoutAtBase(base)};
    });
    assert.strictEqual(threads.length, 3);
    assert.strictEqual(sim._currentThreadSlot, threads[0].slot);
    let nextBase = Math.max(...threads.map(t => t.base + t.layout.lumpSize));
    function install(slot, code, caps = []) {
        const cc = caps.length + 1;
        let size = 64;
        while (size < code.length + cc + 1) size *= 2;
        const base = nextBase;
        nextBase += size;
        assert(nextBase <= sim.NS_TABLE_BASE);
        assert(!sim.readNSEntry(slot));
        assert(sim.memory.slice(base, nextBase).every(w => w === 0));
        const words = new Uint32Array(size);
        words[0] = sim.packLumpHeader(Math.log2(size) - 6, code.length, cc, 0);
        words.set(code, 1);
        words[size - cc] = Sim.SELF_CAPABILITY_PLACEHOLDER;
        words.set(caps, size - cc + 1);
        const header = sim.parseLumpHeader(words[0]);
        assert(sim.mintStep7Freespace(words, header).ok);
        const minted = sim._mintOrdinaryLumpIdentity(words, slot, base, {compilerOwnedSelf: true});
        assert(minted.ok, minted.message);
        sim.memory.set(minted.words, base);
        sim.withNamespaceWrite('private record authority test', () =>
            sim.writeNSEntry(slot, base, header.cw, 0, 0, 1,
                minted.entry.seq, cc, minted.entry.cacheToken));
        assert(sim.mLoad(minted.selfGT, 'E', 1).ok);
        return {slot, base, header, gt: minted.selfGT};
    }
    const record = install(30, assembled.buf.slice(1));
    const methodIndex = compiled.methods.findIndex(m => m.name === methodName);
    assert(methodIndex >= 0);
    const ins = (op, dst = 0, src = 0, imm = 0) =>
        sim.encodeInstruction(op, 14, dst, src, imm);
    const caller = install(31, [
        ins(0, 1, 6, 1 << 4), // LOAD record E authority, then real CALL.
        ins(2, 1, 0, methodIndex + 1),
        ins(21, 4, 1, 0x4000),
    ], [record.gt]);
    // Distinct valid records at the identical offset in every Thread. Direct
    // writes here are fixture seeding only, never the operation under test.
    threads.forEach((t, i) => {
        t.address = t.base + t.layout.heapStart + offset;
        sim.memory.set(R.encode({...R.sample(), callerName: `Thread ${i}`,
            conditions: 111 * (i + 1)}, 7 + i), t.address);
    });
    const heaps = threads.map(t => sim.memory.slice(t.base + t.layout.heapStart,
        t.base + t.layout.heapStart + t.layout.heapWords));
    const otherThreads = threads.slice(1).map(t =>
        sim.memory.slice(t.base, t.base + t.layout.lumpSize));
    const executable = sim.memory.slice(record.base, record.base + record.header.lumpSize);
    const entry = sim.readNSEntry(caller.slot);
    sim._writeCR(0, caller.gt, entry);
    sim._installLumpHeaderContext(sim.parseGT(caller.gt), caller.slot, entry, caller.header);
    sim.pc = 0;
    const sentinel = 0x12345678;
    sim._writeDR(1, sentinel);
    authority(sim);
    const heapAuthority = {...sim.cr[5]};
    const initialSTO = sim.sto;
    const stop = new Error('first fault captured');
    let firstFault;
    sim.fault = (type, message) => {
        firstFault = {type, message, pc: sim.pc, codeBase: sim.cr[14].word1,
            sto: sim.sto, dr1: sim.dr[1],
            instruction: sim.decodeInstruction(sim.memory[sim.cr[14].word1 + 1 + sim.pc])};
        throw stop;
    };
    const retired = [];
    let returned = false;
    for (let budget = 80; budget > 0; budget--) {
        if (sim.cr[14].word1 === caller.base && sim.pc === 2) {
            returned = true;
            break;
        }
        assert(!sim.halted, name);
        try {
            const result = sim.step();
            assert(result && result.instr && !result.skipped, `${name}: instruction retirement`);
            retired.push(result.instr.opcode);
        } catch (error) {
            if (error !== stop) throw error;
            break;
        }
        assert.deepStrictEqual(sim.cr[5], heapAuthority, `${name}: CALL must retain restricted CR5`);
    }
    assert.strictEqual(retired.filter(op => op === 2).length, 1, `${name}: actual CALL`);
    assert.strictEqual(sim._currentThreadSlot, threads[0].slot, name);
    assert.deepStrictEqual(sim.cr[5], heapAuthority, name);
    if (expectedFault) {
        assert(firstFault, `${name}: expected first fault, not successful return or timeout`);
        assert.strictEqual(firstFault.type, expectedFault, name);
        const opcode = methodName === 'ReadConditions' ? 16 : 17;
        assert.strictEqual(firstFault.instruction.opcode, opcode, name);
        assert.strictEqual(firstFault.instruction.crSrc, 5, name);
        assert.strictEqual(firstFault.codeBase, record.base, `${name}: generated method faulted`);
        assert.strictEqual(firstFault.sto, initialSTO - 2, `${name}: CALL frame still active`);
        assert.strictEqual(firstFault.dr1, sentinel, `${name}: rejected read must not supply any record`);
        assert.match(firstFault.message, opcode === 16 ? /^DREAD: CR5/ : /^DWRITE: CR5/);
        if (expectedFault === 'PERMISSION') assert.match(firstFault.message, /lacks W permission/);
        if (expectedFault === 'RANGE') {
            const address = heapAuthority.word1 + fieldOffset;
            assert(firstFault.message.includes(`address ${address} outside valid range`), name);
            const gate = sim.auditLog.at(-1);
            assert.strictEqual(gate.requiredPerm, opcode === 16 ? 'R' : 'W', name);
            for (const check of ['version', 'seal', 'perm'])
                assert.strictEqual(gate.checks[check].pass, true, `${name}: ${check} passed`);
            assert.deepStrictEqual(gate.checks.range, {
                pass: false, address, base: heapAuthority.word1,
                limit: heapAuthority.word1 + fieldOffset - 1,
            }, `${name}: exact one-word-past-bound rejection`);
        }
        assert(!returned, name);
        assert(!retired.includes(3), `${name}: no RETURN after rejected access`);
    } else {
        assert(!firstFault, `${name}: ${JSON.stringify(firstFault)}`);
        assert(returned, `${name}: returned through real RETURN`);
        assert.strictEqual(retired.filter(op => op === 3).length, 1, name);
        assert.strictEqual(sim.sto, initialSTO, name);
        assert.strictEqual(sim.dr[1], 111, `${name}: only the active Thread's value`);
    }
    threads.forEach((t, i) => assert.deepStrictEqual(
        sim.memory.slice(t.base + t.layout.heapStart,
            t.base + t.layout.heapStart + t.layout.heapWords),
        heaps[i], `${name}: Thread ${i} heap unchanged, including revision and adjacent words`));
    threads.slice(1).forEach((t, i) => assert.deepStrictEqual(
        sim.memory.slice(t.base, t.base + t.layout.lumpSize), otherThreads[i],
        `${name}: no fallback to another Thread`));
    assert.deepStrictEqual(sim.memory.slice(record.base, record.base + record.header.lumpSize),
        executable, `${name}: generated code unchanged`);
    console.log(`PASS ${name}`);
}

const nullHeap = sim => { sim.cr[5] = {word0: 0, word1: 0, word2: 0, word3: 0, m: 0}; };
const readOnly = sim => {
    const gt = sim.parseGT(sim.cr[5].word0);
    sim.cr[5].word0 = sim.createGT(gt.gt_seq, gt.index, {R: 1}, 1);
};
// mLoad bounds come from the GT's Namespace entry, not a manually edited
// cached CR word2. Give CR5 a real shortened data authority over this heap;
// keep CR12's full Thread authority intact for the protected CALL frame.
const boundedHeap = limit => sim => {
    const slot = 34;
    assert(!sim.readNSEntry(slot));
    const base = sim.cr[5].word1;
    sim.withNamespaceWrite('private bounded heap authority', () =>
        sim.writeNSEntry(slot, base, limit, 0, 0, 1, 0, 0, 0));
    sim.cr[5] = {...sim.cr[5],
        word0: sim.createGT(0, slot, {R: 1, W: 1}, 1), word2: limit};
};
const truncated = boundedHeap(fieldOffset - 1);
runCase('null CR5 rejects callable read', nullHeap, 'ReadConditions', 'NULL_CAP');
runCase('null CR5 rejects callable write', nullHeap, 'UpdateConditions', 'NULL_CAP');
runCase('read-only CR5 permits callable read and RETURN', readOnly, 'ReadConditions');
runCase('read-only CR5 rejects callable write', readOnly, 'UpdateConditions', 'PERMISSION');
runCase('truncated CR5 rejects callable read', truncated, 'ReadConditions', 'RANGE');
runCase('truncated CR5 rejects callable write', truncated, 'UpdateConditions', 'RANGE');
runCase('inclusive CR5 bound permits callable read and RETURN',
    boundedHeap(fieldOffset), 'ReadConditions');
