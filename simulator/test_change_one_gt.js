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
function fixture(indexed = false) {
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
        words[0] = sim.packLumpHeader(0, code.length, indexed && slot === 32 ? 10 : 1, 0);
        code.forEach((word, i) => words[i + 1] = word);
        words[indexed && slot === 32 ? 54 : 63] = Simulator.SELF_CAPABILITY_PLACEHOLDER;
        if (indexed && slot === 32) words[63] = gt(slots[1]);
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
    const manager = driver(32, 4096, (indexed ? 'CHANGE CR6, #9' : 'CHANGE CR13') + '\nIADD DR2, DR0, #303\nHALT');
    const incoming = driver(33, 4160, 'IADD DR1, DR0, #202\nCHANGE CR2\nHALT');
    const target = slots[1], entry = sim.readNSEntry(target), base = entry.word0_location;
    const layout = sim._threadLayoutAtBase(base);
    sim.memory.fill(0, base + layout.capsStart, base + layout.capsStart + 12);
    sim.memory[base + layout.capsStart] = incoming.gt;
    sim.memory[base + layout.capsStart + 2] = gt(slots[0]);
    assert(sim._formatThreadRootSentinel(base, layout, incoming.gt, {image: true}));
    const rootSTO = layout.stackEnd - 2;
    sim.memory[base + rootSTO - 1] = incoming.gt;
    sim.memory[base + rootSTO] = sim._packFrameWord(0, 1, rootSTO);
    sim.memory[base + 17] = (1 << 12) | (rootSTO - 2);
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
function rejects(name, mutate, reason, indexed = false) {
    test(name, () => {
        const f = fixture(indexed), {sim} = f;
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
test('indexed CHANGE reads exactly one GT and preserves the caller continuation', () => {
    const {sim,target,slots} = fixture(true);
    assert.equal(sim.memory[4097],0x27630009);
    const callerCR6 = {...sim.cr[6]};
    assert(sim.step());
    assert.equal(sim._currentThreadSlot,target);
    assert.equal(sim.stepCount,1,'one instruction, no inserted LOAD');
    assert(sim.step()); assert(sim.step());
    assert.equal(sim._currentThreadSlot,slots[0]);
    assert.equal(sim.pc,1);
    assert.equal(sim.cr[6].word0,callerCR6.word0);
    assert.equal(sim.cr[6].word1,callerCR6.word1);
    assert.equal(sim.dr[1],101);
    assert.deepEqual(sim.faultLog,[]);
});
test('indexed self CHANGE resumes after the same instruction', () => {
    const {sim,slots,gt} = fixture(true);
    sim.memory[4159] = gt(slots[0]);
    const sto = sim.sto;
    assert(sim.step());
    assert.equal(sim.pc,1);
    assert.equal(sim.sto,sto);
    assert.equal(sim._currentThreadSlot,slots[0]);
    assert.deepEqual(sim.faultLog,[]);
});
test('condition-false indexed CHANGE performs no C-list access', () => {
    const {sim} = fixture(true);
    sim.memory[4097] = assemble('CHANGEEQ CR6, #32767')[0];
    sim.flags.Z = false;
    sim.cr[6].m = 0;
    assert(sim.step());
    assert.equal(sim.pc,1);
    assert.deepEqual(sim.faultLog,[]);
});
test('indexed CHANGE accepts source L authority without source M', () => {
    const {sim,gt,target} = fixture(true);
    sim.cr[6].word0 = gt(32,{L:1});
    sim.cr[6].m = 0;
    assert(sim.step(),JSON.stringify(sim.faultLog));
    assert.equal(sim._currentThreadSlot,target);
    assert.deepEqual(sim.faultLog,[]);
});
rejects('indexed CHANGE bounds', f => {
    f.sim.memory[4097] = assemble('CHANGE CR6, #10')[0];
}, /out of bounds/, true);
rejects('indexed CHANGE requires C-list load authority', f => {
    f.sim.cr[6].m = 0;
}, /C-list access/, true);
rejects('indexed CHANGE rejects NULL target', f => {
    f.sim.memory[4159] = 0;
}, /non-null/, true);
rejects('indexed CHANGE rejects non-Thread target', f => {
    f.sim.memory[4159] = f.gt(32);
}, /Thread descriptor/, true);
for (const permission of ['B','R','W','X','L','S','E']) {
    rejects(`indexed CHANGE rejects Thread permission ${permission}`, f => {
        f.sim.memory[4159] = f.gt(f.target,{[permission]:1});
    }, /no permissions/, true);
}
rejects('indexed CHANGE rejects stale Thread', f => {
    f.sim.memory[4159] = f.sim.createGT(63,f.target,{},1);
}, /seq mismatch|stale/i, true);
rejects('indexed CHANGE validates incoming frame', f => {
    f.sim.memory[f.base+17] = 0;
}, /frame/, true);
rejects('indexed CHANGE validates incoming C-list', f => {
    f.sim.memory[f.incoming.base+63] = 0;
}, /C-List SELF/, true);
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
for (const register of [12, 13]) {
    test(`self CHANGE CR${register} restores the new continuation without M authority`, () => {
        const {sim, slots, gt} = fixture();
        sim.memory[4097] = assemble(`CHANGE CR${register}`)[0];
        sim.cr[register].word0 = gt(slots[0]);
        sim.cr[register].m = 0;
        const sto = sim.sto, flags = {...sim.flags};
        const caps = sim.cr.slice(0, 5).map(r => r.word0);
        for (let repeat = 0; repeat < 5; repeat++) {
            sim.pc = 0;
            sim.dr[1] = 101 + repeat;
            assert(sim.step(), JSON.stringify(sim.faultLog));
            assert.equal(sim.pc, 1);
            assert.equal(sim.sto, sto);
            assert.deepEqual(sim.flags, flags);
            assert.equal(sim.dr[1], 101 + repeat);
            assert.deepEqual(sim.cr.slice(0, 5).map(r => r.word0), caps);
            assert.equal(sim._currentThreadSlot, slots[0]);
        }
        assert(sim.step());
        assert.equal(sim.dr[2], 303);
        assert.deepEqual(sim.faultLog, []);
    });
}
rejects('self CHANGE still rejects invalid current C-List atomically', f => {
    f.sim.cr[13].word0 = f.gt(f.slots[0]);
    f.sim.memory[4096 + 63] = 0;
}, /C-List SELF/);
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