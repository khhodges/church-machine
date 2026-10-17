'use strict';
// Negative G4 evidence only. Test-owned RAM/CR setup is NOT Mint provisioning.
// No interlock, service, filesystem writes, image activation, network or hardware.
const assert = require('node:assert/strict');
global.window = {bootConfig: {step1: {
    totalNamespaceWords: 16384, namespaceLumpWords: 64,
    threadLumpWords: 512, threadCount: 3,
}}};
const Simulator = require('../../simulator/simulator');
const Assembler = require('../../simulator/assembler');
const rows = [];
const words = (s, address) => Array.from(s.memory.slice(address, address + 4));
const equal = (a, b) => a.length === 4 && b.length === 4 &&
    a.every((word, i) => word === b[i]);
function decode(s, source) {
    const a = new Assembler(), result = a.assemble(source);
    assert.deepEqual(a.errors, []);
    assert.equal(result.words.length, 1);
    return s.decodeInstruction(result.words[0]);
}
function fixture() {
    const s = new Simulator();
    for (let i = 0; !s.bootComplete && !s.halted && i < 32; i++) s._bootStep();
    assert(s.bootComplete && !s.halted, JSON.stringify(s.faultLog));
    const slot = 40, address = s._nsSlotBase(slot);
    s.withNamespaceWrite('synthetic G4 setup', () => {
        s.writeNSEntry(slot, 4096, 63, 0, 0, 1, 7, 0, 0x4a070028);
        // Test-only authority to an alias of the descriptor, not a legal Mint grant.
        s.writeNSEntry(41, address, 3, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(42, 6144, 3, 0, 0, 1, 0, 1, 0);
    });
    // Constructor placeholders have no callable C-List. Supply exact synthetic
    // executable geometry for CHANGE tests, rather than repairing live artifacts.
    const enter = s.createGT(0, 42, {E: 1}, 1);
    s.memory[6144] = s.packLumpHeader(0, 3, 1, 0);
    s.memory[6207] = enter;
    for (const thread of s.configuredThreadSlots()) {
        const base = s.readNSEntry(thread).word0_location;
        const layout = s._threadLayoutAtBase(base);
        s.memory[base + layout.capsStart] = enter;
        assert(s._formatThreadRootSentinel(base, layout, enter, {image: true}));
        if (thread !== s._currentThreadSlot) {
            const root = layout.stackEnd - 2;
            s.memory[base + root - 1] = enter;
            s.memory[base + root] = s._packFrameWord(0, 1, root);
            s.memory[base + 17] = (1 << 12) | (root - 2);
        }
    }
    s._writeCR(0, enter, s.readNSEntry(42));
    s._installLumpHeaderContext(s.parseGT(enter), 42, s.readNSEntry(42),
        s.parseLumpHeader(s.memory[6144]));
    s.pc = 0;
    s.cr[10] = {word0: s.createGT(0, 41, {R: 1, W: 1}, 1),
        word1: address, word2: 3, word3: 0, m: 0};
    for (const thread of s.configuredThreadSlots()) {
        if (thread === s._currentThreadSlot) continue;
        const base = s.readNSEntry(thread).word0_location;
        // Explicit competing-writer fixture grant; not an operational Mint grant.
        s.memory[base + s._threadLayoutAtBase(base).capsStart + 10] = s.cr[10].word0;
    }
    // Deliberately inert annotation, never passed to or consumed by an engine API.
    const marker = Object.freeze({admitted: true, request: 'synthetic', slot, address});
    return {s, slot, address, marker, old: words(s, address)};
}
function write(f, index, value) {
    f.s.dr[1] = value >>> 0;
    assert(f.s._execDwrite(decode(f.s, `DWRITE DR1, CR10, #${index}`)),
        JSON.stringify(f.s.faultLog));
}
function record(name, detail) { rows.push({name, ...detail}); }

async function main() {
    // Model READ and the COMMIT precondition only; never perform a Mint COMMIT.
    {
        const f = fixture();
        assert(equal(f.old, words(f.s, f.address)));
        record('unchanged-control', {oldWordsEqual: true, exclusionEstablished: false});
    }
    for (const kind of ['permission', 'bounds']) {
        const f = fixture();
        if (kind === 'permission') f.s.cr[10].word0 = f.s.createGT(0, 41, {R: 1}, 1);
        f.s.dr[1] = 99;
        assert.equal(f.s._execDwrite(decode(f.s,
            `DWRITE DR1, CR10, #${kind === 'bounds' ? 4 : 0}`)), null);
        assert(f.s.halted);
        assert(equal(f.old, words(f.s, f.address)));
        record(`${kind}-control`, {rejected: true, oldWordsEqual: true});
    }
    // Each word is independently changed so a generation-only test cannot pass.
    for (let index = 0; index < 4; index++) {
        const f = fixture();
        write(f, index, f.old[index] ^ 1);
        const actual = words(f.s, f.address);
        assert.equal(equal(f.old, actual), false);
        assert.deepEqual(actual.filter((_, i) => i !== index),
            f.old.filter((_, i) => i !== index));
        record(`changed-W${index}`, {old: f.old, actual, oldWordsEqual: false});
    }
    for (const lambdaActive of [false, true]) {
        const f = fixture();
        // Covers the inactive verifier gap and a latch-only boundary; setting
        // this existing flag does NOT exercise or repair M2 Lambda semantics.
        f.s.lambdaActive = lambdaActive;
        const observations = [];
        for (let i = 0; i < 4; i++) {
            write(f, i, f.old[i] ^ 1);
            observations.push(words(f.s, f.address));
        }
        assert.deepEqual(observations[0], [f.old[0] ^ 1, ...f.old.slice(1)]);
        const intervening = words(f.s, f.address);
        assert(intervening.every((word, i) => word !== f.old[i]));
        for (let i = 0; i < 4; i++) write(f, i, f.old[i]);
        const actual = words(f.s, f.address);
        assert(equal(f.old, actual));
        assert.equal(f.s.lambdaActive, lambdaActive);
        assert.equal(f.marker.admitted, true);
        record(`ABA-lambda-${lambdaActive}`, {
            old: f.old, observations, intervening, actual, oldWordsEqual: true,
            targetWrites: 8, exclusionEstablished: false,
        });
    }
    {
        const f = fixture();
        assert.throws(() => f.s.writeNSEntry(f.slot, 4352, 127, 0, 0, 1, 8, 0, 99),
            /outside an allowed write window/);
        assert(equal(f.old, words(f.s, f.address)));
        // A queued host action really runs after READ and before comparison.
        await Promise.resolve().then(() => f.s.withNamespaceWrite('synthetic programmer action',
            () => f.s.writeNSEntry(f.slot, 4352, 127, 0, 0, 1, 8, 0, 99)));
        assert.equal(equal(f.old, words(f.s, f.address)), false);
        record('queued-host-namespace-writer', {
            old: f.old, actual: words(f.s, f.address), markerHeld: f.marker.admitted,
            unscopedWriteRejected: true,
        });
    }
    {
        const f = fixture();
        await Promise.resolve().then(() => f.s.memory.set([1, 2, 3, 4], f.address));
        assert.deepEqual(words(f.s, f.address), [1, 2, 3, 4]);
        f.s.memory.set(f.old, f.address);
        assert(equal(f.old, words(f.s, f.address)));
        record('host-typed-array-ABA', {oldWordsEqual: true, markerHeld: true});
    }
    for (const self of [true, false]) {
        const f = fixture(), before = f.s._currentThreadSlot;
        const slot = self ? before : f.s.configuredThreadSlots().find(x => x !== before);
        const entry = f.s.readNSEntry(slot);
        f.s.cr[2] = {word0: f.s.createGT(f.s.parseNSWord1(entry.word1_limit).gtSeq, slot, {}, 1),
            word1: entry.word0_location, word2: entry.word1_limit, word3: 0, m: 0};
        const result = f.s._execChange(decode(f.s, 'CHANGE CR2'), f.s.pc + 1);
        assert(result, JSON.stringify(f.s.faultLog));
        assert.equal(f.s._currentThreadSlot, slot);
        assert(equal(f.old, words(f.s, f.address)));
        record(self ? 'self-CHANGE' : 'distinct-CHANGE', {
            before, after: slot, oldWordsEqual: true, markerHeld: f.marker.admitted,
        });
    }
    {
        const f = fixture(), before = f.s._currentThreadSlot;
        const selected = f.s.advanceConfiguredThread();
        assert(selected.ok, selected.reason);
        const writer = f.s._currentThreadSlot;
        assert.notEqual(writer, before);
        // Use the alias restored by CHANGE from the other Thread's own home.
        assert.equal(f.s.cr[10].word1, f.address);
        for (let i = 0; i < 4; i++) write(f, i, f.old[i] ^ 1);
        const intervening = words(f.s, f.address);
        for (let i = 0; i < 4; i++) write(f, i, f.old[i]);
        const returned = f.s.selectConfiguredThread(before);
        assert(returned.ok, returned.reason);
        assert.equal(f.s._currentThreadSlot, before);
        assert(equal(f.old, words(f.s, f.address)));
        record('other-Thread-ABA-and-return', {before, writer, after: before,
            intervening, old: f.old, actual: words(f.s, f.address),
            oldWordsEqual: true, markerHeld: f.marker.admitted});
    }
    {
        const f = fixture(), before = f.s._currentThreadSlot;
        f.s.halted = true; // IDE pause is not ownership release or Mint exclusion.
        const result = f.s.advanceConfiguredThread();
        assert(result.ok, result.reason);
        assert.notEqual(f.s._currentThreadSlot, before);
        assert(equal(f.old, words(f.s, f.address)));
        record('paused-IDE-thread-selection', {before, after: f.s._currentThreadSlot,
            oldWordsEqual: true, markerHeld: true});
    }
    {
        const f = fixture(), slot = f.s._currentThreadSlot;
        // Existing image-baseline capture/reset, NOT Amobea checkpoint rollback.
        assert(f.s._suspendLiveThread(slot, null, f.s.pc + 1));
        f.s._captureThreadBaselines();
        const base = f.s.cr[12].word1;
        const initial = f.s.memory[base + 2];
        f.s._writeDR(1, initial ^ 1);
        assert.notEqual(f.s.memory[base + 2], initial);
        const result = f.s.resetThreadToBaseline(slot);
        assert(result.ok, result.reason);
        assert.equal(f.s.memory[base + 2], initial);
        assert.equal(f.s._currentThreadSlot, slot);
        assert(equal(f.old, words(f.s, f.address)));
        record('baseline-reset-reactivation', {oldWordsEqual: true, markerHeld: true});
    }
    {
        const f = fixture(), oldMemory = f.s.memory;
        f.s.reset('synthetic G4 reset');
        assert.notEqual(f.s.memory, oldMemory);
        assert.equal(equal(f.old, words(f.s, f.address)), false);
        record('reset-replaces-memory', {markerHeld: f.marker.admitted,
            oldWordsEqual: false, containmentProven: false});
    }
    probeNamespaceSwitch();
    console.log(JSON.stringify({
        status: 'EXPECTED GAPS REPRODUCED; G4 OPEN; NOT OPERATIONAL MINT',
        cases: rows,
        notExercised: ['M1/M2/M3', 'Amobea checkpoint service',
            'live image activation', 'RTL/FPGA/UART', 'fault-cut containment'],
    }, null, 2));
}

function probeNamespaceSwitch() {
    // Separate slot-0 Namespace profile, never installed into the IDE or disk.
    const memory = new Uint32Array(16384);
    for (const base of [0, 8192]) {
        memory[base] = ((31 << 27) | (64 << 10) | (1 << 8)) >>> 0;
        memory[base + 1] = base;
        memory[base + 2] = 2;
    }
    const s = Simulator.fromNamespaceImage(memory,
        {word0: 0x02000001, word1: 0, word2: 255, word3: 0, m: 1});
    function descriptor(ns, slot, base, limit) {
        const w1 = s.packNSWord1(limit, 0, 0, 0);
        s.memory.set([base, w1, s._integrity32(base, w1), 0], ns + slot * 4);
    }
    for (const ns of [0, 8192]) {
        descriptor(ns, 1, ns, 255);
        descriptor(ns, 2, ns + 256, 255);
        descriptor(ns, 4, ns + 512, 1);
        const gt = s.createGT(0, 4, {E: 1}, 1);
        s.memory[ns + 512] = s.packLumpHeader(0, 1, ns ? 1 : 2, 0);
        s.memory[ns + 513] = 0; // not fetched: switch entry is invoked directly
        s.memory[ns + (ns ? 575 : 574)] = gt;
        if (!ns) s.memory[575] = s.createGT(0, 8, {}, 1);
        s.memory[ns + 256] = s.packLumpHeader(2, 32, 12, 2);
        // Destination is outside the active root until SWITCH; use the geometry
        // constructor for test image construction, not an out-of-root read grant.
        const layout = require('../../simulator/thread_design').layout(256, 32);
        s.memory[ns + 256 + layout.capsStart] = gt;
        assert(s._formatThreadRootSentinel(ns + 256, layout, gt, {image: true}));
    }
    descriptor(0, 8, 8192, 255);
    assert(s.startEntryThread(), JSON.stringify(s.faultLog));
    s.cr[15].m = 1; // fixture privilege, NOT an operational M grant
    const marker = Object.freeze({admitted: true});
    const address = 20 * 4, old = words(s, address);
    assert(s._execSwitch(decode(s, 'SWITCH CR15, CR6, #1')), JSON.stringify(s.faultLog));
    assert.equal(s.cr[15].word1, 8192);
    assert.equal(s.cr[12].word1, 8448);
    assert(equal(old, words(s, address)), 'compare original physical slot, not redirected CR15');
    record('cross-Namespace-SWITCH', {beforeRoot: 0, afterRoot: 8192,
        oldWordsEqual: true, markerHeld: marker.admitted});
}
main().catch(error => { console.error(error); process.exitCode = 1; });
