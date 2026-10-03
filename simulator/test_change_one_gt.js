'use strict';
// Pure in-memory fixtures: no saved user LUMPs, Namespace writes to disk or board.
const assert = require('node:assert/strict');
global.window = {bootConfig: {step1: {
    totalNamespaceWords: 16384, namespaceLumpWords: 64,
    threadLumpWords: 512, threadCount: 3,
}}};
const Simulator = require('./simulator.js');
const Assembler = require('./assembler.js');
function assemble(text) {
    const a = new Assembler(), result = a.assemble(text);
    assert.deepEqual(a.errors, []);
    return result.words;
}
function fixture() {
    const sim = new Simulator();
    for (let i = 0; !sim.bootComplete && !sim.halted && i < 32; i++) sim._bootStep();
    assert(sim.bootComplete && !sim.halted, 'separate boot back half still works');
    const slots = sim.configuredThreadSlots();
    function gt(slot, rights = {}) {
        return sim.createGT(sim.parseNSWord1(sim.readNSEntry(slot).word1_limit).gtSeq,
            slot, rights, 1);
    }
    function driver(slot, base, text) {
        const code = assemble(text), words = Array(64).fill(0);
        words[0] = sim.packLumpHeader(0, code.length, 1, 0);
        code.forEach((word, i) => words[i + 1] = word);
        words[63] = Simulator.SELF_CAPABILITY_PLACEHOLDER;
        assert(sim.memory.slice(base, base + 64).every(w => w === 0));
        const minted = sim._mintOrdinaryLumpIdentity(words, slot, base, {compilerOwnedSelf: true});
        assert(minted.ok, minted.message);
        sim.memory.set(minted.words, base);
        sim.withNamespaceWrite('in-memory CHANGE test', () => {
            sim.writeNSEntry(slot, base, code.length, 0, 0, 1,
                minted.entry.seq, 1, minted.entry.cacheToken);
        });
        return {gt: minted.selfGT, entry: sim.readNSEntry(slot),
            header: sim.parseLumpHeader(minted.words[0]), base};
    }
    const manager = driver(32, 4096, 'CHANGE CR13\nIADD DR2, DR0, #303\nHALT');
    const incoming = driver(33, 4160, 'IADD DR1, DR0, #202\nCHANGE CR2\nHALT');
    const target = slots[1], entry = sim.readNSEntry(target), base = entry.word0_location;
    const layout = sim._threadLayoutAtBase(base);
    sim.memory.fill(0, base + layout.capsStart, base + layout.capsStart + 12);
    sim.memory[base + layout.capsStart] = incoming.gt;
    sim.memory[base + layout.capsStart + 2] = gt(slots[0]);
    assert(sim._formatThreadRootSentinel(base, layout, incoming.gt, {image: true}));
    sim._writeCR(0, manager.gt, manager.entry);
    sim._installLumpHeaderContext(sim.parseGT(manager.gt), 32, manager.entry, manager.header);
    sim.cr[13] = {word0: gt(target), word1: entry.word0_location,
        word2: entry.word1_limit, word3: 0, m: 0};
    sim.pc = 0;
    sim.dr[1] = 101;
    return {sim, target, base, layout, slots, gt, incoming};
}
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS', name); }
test('instruction-driven CR13 -> Thread.2 -> manager preserves continuation and data', () => {
    const {sim, target, slots} = fixture();
    const first = sim.step();
    assert(first, sim.faultLog.map(f => f.rawDiagnosticReason).join('\n'));
    assert.equal(sim.halted, false, JSON.stringify(sim.faultLog));
    assert.equal(sim._currentThreadSlot, target);
    assert.equal(sim.pc, 0);
    assert(sim.step());
    assert.equal(sim.dr[1], 202);
    assert(sim.step());
    assert.equal(sim._currentThreadSlot, slots[0]);
    assert.equal(sim.pc, 1);
    assert.equal(sim.dr[1], 101);
    assert(sim.step());
    assert.equal(sim.dr[2], 303);
    assert.deepEqual(sim.faultLog, []);
});
function rejects(name, mutate, reason) {
    test(name, () => {
        const f = fixture(), {sim} = f;
        mutate(f);
        const memory = sim.memory.slice(), cr = sim.cr.map(r => ({...r}));
        const dr = [...sim.dr], slot = sim._currentThreadSlot;
        sim.step();
        assert(sim.halted, 'hard fault halts execution');
        assert(sim.faultLog.length, 'hard fault is recorded');
        assert.match(sim.faultLog.at(-1).rawDiagnosticReason, reason);
        assert.equal(sim._currentThreadSlot, slot, 'no activation on error');
        // Fetch and identity validation may set Namespace access/G bits.
        // Protected Thread bodies and executable payloads must stay untouched.
        assert.deepEqual(sim.memory.slice(0, sim.NS_TABLE_BASE),
            memory.slice(0, sim.NS_TABLE_BASE), 'no partial context memory writes');
        assert.deepEqual(sim.cr, cr, 'no partial register restore');
        assert.deepEqual([...sim.dr], dr, 'no partial DR restore');
    });
}
for (const permission of ['B', 'R', 'W', 'X', 'L', 'S', 'E']) {
    rejects(`permission ${permission} is a hard fault`, f => {
        f.sim.cr[13].word0 = f.gt(f.target, {[permission]: 1});
    }, /no permissions/);
}
rejects('NULL Thread GT', f => { f.sim.cr[13].word0 = 0; }, /non-null/);
rejects('non-Thread object', f => { f.sim.cr[13].word0 = f.gt(32); }, /Thread descriptor/);
rejects('stale Thread generation', f => {
    const p = f.sim.parseGT(f.sim.cr[13].word0);
    f.sim.cr[13].word0 = f.sim.createGT((p.gt_seq + 1) & 15, f.target, {}, 1);
}, /CHANGE Thread GT/);
rejects('invalid stack indicator', f => { f.sim.memory[f.base + 17] = 0; }, /frame/);
rejects('invalid stack Enter GT', f => {
    const s = f.sim._unpackProtectedIndicator(f.sim.memory[f.base + 17]).sto;
    f.sim.memory[f.base + s + 1] = 0;
}, /Inform E-GT/);
rejects('empty C-List SELF', f => { f.sim.memory[f.incoming.base + 63] = 0; }, /C-List SELF/);
rejects('wrong C-List SELF identity', f => {
    f.sim.memory[f.incoming.base + 63] = f.gt(32, {E:1});
}, /C-List SELF/);
rejects('C-List geometry mismatch', f => {
    f.sim.memory[f.incoming.base] = f.sim.packLumpHeader(0, 3, 0, 0);
}, /C-List.*geometry/);
rejects('self activation cannot restore a stale dormant frame', f => {
    f.sim.cr[13].word0 = f.gt(f.slots[0]);
}, /active Thread/);
rejects('unexpected validation error becomes a hard fault', f => {
    f.sim._readThreadResumeFrame = () => { throw new Error('injected frame validation error'); };
}, /injected frame validation error/);
rejects('indexed legacy CHANGE rejected, not silently reinterpreted', f => {
    f.sim.memory[4097] = assemble('CHANGE CR13, CR13, #1')[0];
}, /one Thread GT/);
test('manual Thread selection uses the same validation', () => {
    const {sim, target} = fixture();
    assert(sim.selectConfiguredThread(target).ok);
    assert.equal(sim._currentThreadSlot, target);
    assert.equal(sim.faultLog.length, 0);
});
console.log(`${count} one-GT CHANGE checks passed`);