'use strict';

const assert = require('assert');
const ChurchSimulator = require('./simulator.js');

function enterGT(sim, slot) {
    const entry = sim.readNSEntry(slot);
    return sim.createGT(entry.gtSeq, slot, { E: 1 }, 1);
}

function branchWord(offset) {
    return (((23 << 27) | (offset & 0x7FFF)) >>> 0);
}

function installEmbeddedApi(sim, slot, methods) {
    const entry = sim.readNSEntry(slot);
    const base = entry.word0_location;
    const apiBytes = new TextEncoder().encode(JSON.stringify({
        name: sim.nsLabels[slot],
        methods: methods.map((name, index) => ({ name, index })),
    }));
    const start = base + 1 + sim.parseLumpHeader(sim.memory[base]).cw;
    sim.memory[start] = ((0xAB << 24) | apiBytes.length) >>> 0;
    for (let i = 0; i < apiBytes.length; i++) {
        const shift = 24 - ((i & 3) * 8);
        sim.memory[start + 1 + (i >>> 2)] |= apiBytes[i] << shift;
    }
}

function namedCallFixture() {
    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    // Two exact BRANCH dispatch entries, then two method bodies.
    const words = [branchWord(2), branchWord(3), 0, 0, 0];
    const targetSlot = sim.saveToNamespace('NamedTarget', words, { E: 1 }, 1);
    const targetEntry = sim.readNSEntry(targetSlot);
    const targetGT = enterGT(sim, targetSlot);
    const callerSlot = sim.saveToNamespace(
        'NamedCaller', words, { E: 1 }, 1, [{}], [targetGT]);
    installEmbeddedApi(sim, callerSlot, ['Start', 'CallingMethod']);
    installEmbeddedApi(sim, targetSlot, ['DirectEntry', 'IndexedEntry']);
    const callerEntry = sim.readNSEntry(callerSlot);
    const callerGT = enterGT(sim, callerSlot);
    const callerHeader = sim.parseLumpHeader(sim.memory[callerEntry.word0_location]);
    const callerClistBase = callerEntry.word0_location +
        callerHeader.lumpSize - callerHeader.cc;
    sim.cr[6] = {
        word0: callerGT, word1: callerClistBase,
        word2: callerEntry.word1_limit, word3: callerEntry.word2_seals, m: 0,
    };
    sim.cr[14] = {...sim.cr[6], word1: callerEntry.word0_location};
    sim.cr[0] = {
        word0: targetGT, word1: targetEntry.word0_location,
        word2: targetEntry.word1_limit, word3: targetEntry.word2_seals, m: 0,
    };
    sim.pc = 4; // Exact second caller body range.
    sim._nsStubFlags[targetSlot] = true; // Fault before target mutates CR14.
    return { sim, targetGT };
}

// Exercise the real malformed method-table dispatch path.  The caller identity
// must be frozen before _execCall installs the target in CR14.
{
    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    const callerSlot = sim.saveToNamespace(
        'CallerPet', [0], { E: 1 }, 1);
    const targetSlot = sim.saveToNamespace(
        'DestinationPet', [0xFFFFFFFF, 0], { E: 1 }, 1);
    const callerEntry = sim.readNSEntry(callerSlot);
    const targetEntry = sim.readNSEntry(targetSlot);
    const callerGT = enterGT(sim, callerSlot);
    const targetGT = enterGT(sim, targetSlot);

    sim.cr[6] = {
        word0: callerGT, word1: callerEntry.word0_location,
        word2: callerEntry.word1_limit, word3: callerEntry.word2_seals, m: 0,
    };
    sim.cr[14] = {...sim.cr[6]};
    sim.cr[0] = {
        word0: targetGT, word1: targetEntry.word0_location,
        word2: targetEntry.word1_limit, word3: targetEntry.word2_seals, m: 0,
    };

    sim._execCall({ opcode: 2, cond: 0, crDst: 0, crSrc: 0, imm: 1 });
    const fault = sim.faultLog[sim.faultLog.length - 1];

    assert.strictEqual(fault.type, 'INVALID_OP');
    assert.match(fault.message,
        /^From CallerPet\.unknown -> To DestinationPet\.method#1 — /);
    assert.match(fault.rawDiagnosticReason,
        /^CALL CR0: method index 1 entry 0xffffffff is neither a BRANCH/);
    assert(!fault.rawDiagnosticReason.includes('From '));
    assert.strictEqual(fault.callRoute.callerSlot, callerSlot);
    assert.strictEqual(fault.callRoute.destinationSlot, targetSlot);
}

// Exact names come only from the API frame embedded in the same live binary
// whose BRANCH table and PC ranges are validated.
{
    const { sim } = namedCallFixture();
    sim._captureFaultRoute({ opcode: 2, crSrc: 0, imm: 1 });
    sim._execCall({ opcode: 2, cond: 0, crDst: 0, crSrc: 0, imm: 1 });
    assert.match(sim.faultLog[0].message,
        /^From NamedCaller\.CallingMethod -> To NamedTarget\.DirectEntry — /);
}

// Direct selector zero names the first verified binary entry point.
{
    const { sim } = namedCallFixture();
    sim._captureFaultRoute({ opcode: 2, crSrc: 0, imm: 0 });
    sim._execCall({ opcode: 2, cond: 0, crDst: 0, crSrc: 0, imm: 0 });
    assert.match(sim.faultLog[0].message,
        /^From NamedCaller\.CallingMethod -> To NamedTarget\.DirectEntry — /);
}

// The indexed path passes its resolved GT and positive dispatch selector to
// _execCall; selector 2 maps to embedded API index 1.
{
    const { sim } = namedCallFixture();
    const encoded = (2 << 5); // selector 2, c-list row 0
    sim._captureFaultRoute({ opcode: 2, crSrc: 6, imm: encoded });
    sim._execIndexedCall({
        opcode: 2, cond: 0, crDst: 0, crSrc: 6, imm: encoded,
    });
    assert.match(sim.faultLog[0].message,
        /^From NamedCaller\.CallingMethod -> To NamedTarget\.IndexedEntry — /);
}

// A NULL direct target still retains its selector without inventing a callee.
{
    const { sim } = namedCallFixture();
    sim.cr[0].word0 = 0;
    sim._captureFaultRoute({ opcode: 2, crSrc: 0, imm: 1 });
    sim._execCall({ opcode: 2, cond: 0, crDst: 0, crSrc: 0, imm: 1 });
    assert.match(sim.faultLog[0].message,
        /^From NamedCaller\.CallingMethod -> To unknown\.method#1 — CALL: CR0 is NULL$/);
}

// Missing execution/target metadata is explicit; it must never be filled from
// a stale abstraction registry or API method list.
{
    const sim = new ChurchSimulator();
    const reason = 'unchanged low-level reason';
    sim.fault('TYPE', reason);
    const fault = sim.faultLog[0];
    assert.strictEqual(fault.rawDiagnosticReason, reason);
    assert.strictEqual(
        fault.message,
        `From unknown.unknown -> To unknown.unknown — ${reason}`);
}

console.log('fault CALL route tests passed');