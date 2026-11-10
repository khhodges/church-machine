'use strict';
const assert = require('node:assert/strict');
const {createDemo, hash} = require('./revision_adoption');

function snapshot(d) {
    return {memory: hash(Array.from(d.sim.memory)), cr: structuredClone(d.sim.cr),
        pc: d.sim.pc, sto: d.sim.sto, frames: structuredClone(d.sim.callStack)};
}
function finish(d) {
    for (let n = 0; n < 100 && !d.sim.halted; n++) d.sim.step();
    assert(d.sim.halted, 'caller must reach its authored HALT');
    return d.sim.dr[1];
}
const caller = 'LOAD CR1, CR6, #1\nCALL CR1, #0\nHALT';
const evidence = [];
for (const [oldSize, newSize] of [[64, 256], [256, 64]]) {
    const d = createDemo();
    const old = d.install('IADD DR1, DR0, #17\nRETURN', {size: oldSize});
    const oldCaller = d.install(caller, {dependency: old});
    d.activate(oldCaller);
    d.sim.pc = 1;
    d.sim.step(); d.sim.step(); // Real LOAD and CALL, protected frame in Thread RAM.
    assert.equal(d.sim.cr[6].word0, old.gt);
    const active = snapshot(d);
    const threadBase = d.sim._activeThreadBase();
    const threadSize = d.sim.parseLumpHeader(d.sim.memory[threadBase]).lumpSize;
    assert(threadSize > 0);
    const protectedMemory = d.sim.memory.slice(threadBase, threadBase + threadSize);
    const oldBytes = d.sim.memory.slice(old.base, old.base + oldSize);
    const next = d.install('IADD DR1, DR0, #29\nRETURN', {size: newSize});
    const newCaller = d.install(caller, {dependency: next});
    assert.notEqual(old.gt, next.gt);
    assert.notEqual(old.hash, next.hash);
    assert(old.base + oldSize <= next.base);
    assert.equal(next.hdr.lumpSize, newSize);
    assert.deepEqual(d.sim.cr, active.cr);
    assert.equal(d.sim.pc, active.pc);
    assert.equal(d.sim.sto, active.sto);
    assert.deepEqual(d.sim.callStack, active.frames);
    assert.deepEqual(d.sim.memory.slice(threadBase, threadBase + threadSize), protectedMemory,
        'publication must preserve the protected Thread continuation bytes');
    assert.deepEqual(d.sim.memory.slice(old.base, old.base + oldSize), oldBytes);
    assert.equal(finish(d), 17, 'active old call and RETURN survive publication');
    for (const [domain, value] of [[newCaller, 29], [oldCaller, 17]]) {
        d.sim.halted = false;
        d.activate(domain); d.sim.pc = 1;
        assert.equal(finish(d), value);
    }
    evidence.push({oldSize, newSize, old: old.hash, new: next.hash,
        oldGT: old.gt, newGT: next.gt, peakReservedWords: d.reservedWords,
        results: [17, 29, 17], events: d.events});
}

for (const failure of ['memory', 'tamper', 'truncated', 'extra', 'unauthorized',
    'interrupted', 'duplicate', 'stale', 'occupied']) {
    const d = createDemo({capacity: failure === 'memory' ? 128 : 1024});
    const old = d.install('IADD DR1, DR0, #17\nRETURN');
    const outer = d.install(caller, {dependency: old});
    d.activate(outer); d.sim.pc = 1; d.sim.step(); d.sim.step();
    const c = d.compile('IADD DR1, DR0, #29\nRETURN', {size: 256});
    const before = snapshot(d);
    if (failure === 'memory') assert.throws(() => d.stage(c.words, c.ticket), /insufficient memory/);
    if (failure === 'tamper') {
        const words = [...c.words]; words[2] ^= 1;
        assert.throws(() => d.stage(words, c.ticket), /validation/);
    }
    if (failure === 'truncated') assert.throws(() => d.stage(c.words.slice(1), c.ticket), /validation/);
    if (failure === 'extra') assert.throws(() => d.stage([...c.words, 0], c.ticket), /validation/);
    if (failure === 'unauthorized') {
        assert.throws(() => d.stage(c.words, {}), /unauthorized/);
        assert.throws(() => d.compile(caller, {dependency: {...old}}), /unauthorized/);
    }
    if (failure === 'interrupted' || failure === 'duplicate') {
        const h = d.stage(c.words, c.ticket);
        if (failure === 'interrupted') {
            d.cancel(h);
            assert.throws(() => d.publish(h), /stale/);
        }
        assert.throws(() => d.stage(c.words, c.ticket), /stale/);
    }
    if (failure === 'occupied') {
        const h = d.stage(c.words, c.ticket);
        const base = d.events.at(-1).base;
        d.sim.memory[base] = 123; // Competing owner, never an old allocation.
        assert.throws(() => d.publish(h), /occupied/);
        d.sim.memory[base] = 0;
    }
    if (failure === 'stale') {
        const next = d.install('IADD DR1, DR0, #29\nRETURN', {size: 256});
        const approved = d.compile(caller, {dependency: next});
        const h = d.stage(approved.words, approved.ticket);
        const ns = d.sim._nsSlotBase(next.slot);
        d.sim.memory[ns + 1] ^= 1 << 21; // Authorized-software generation change fixture.
        assert.throws(() => d.publish(h), /stale dependency/);
        assert.equal(d.sim.mLoad(next.gt, 'E', 1).ok, false);
        const context = snapshot(d);
        d.sim.cr[1].word0 = next.gt;
        let fault;
        const handler = d.sim.fault;
        d.sim.fault = (type) => { fault = type; };
        assert.equal(d.sim._execCall({crDst: 1, imm: 1}), null);
        d.sim.fault = handler;
        assert.equal(fault, 'VERSION', 'ordinary CALL rejects the stale GT');
        d.sim.cr[1] = context.cr[1];
        assert.deepEqual(snapshot(d), context, 'rejected CALL cannot replace the active frame');
    } else {
        assert.deepEqual(snapshot(d), before, `${failure} must not change executable state`);
    }
    assert.equal(d.sim.cr[6].word0, old.gt);
    assert.equal(finish(d), 17, `${failure}: original continuation must return`);
}
{
    const d = createDemo();
    const before = snapshot(d);
    for (const size of [0, -1, 63, 65, 2048, 1.5, NaN])
        assert.throws(() => d.compile('RETURN', {size}), /allocation bounds/);
    for (const capacity of [-1, 1.5, 65536])
        assert.throws(() => createDemo({capacity}), /arena bounds/);
    assert.throws(() => d.compile('NOT_AN_INSTRUCTION'), /./);
    assert.deepEqual(snapshot(d), before);
    const large = d.install('IADD DR1, DR0, #29\n' +
        'IADD DR2, DR0, #0\n'.repeat(80) + 'RETURN');
    assert.equal(large.hdr.lumpSize, 128, 'ordinary builder grows for actual code, not only padding');
    const outer = d.install(caller, {dependency: large});
    d.activate(outer); d.sim.pc = 1;
    assert.equal(finish(d), 29);
}
console.log(JSON.stringify({scope: 'local simulator; no RTL or hardware claim', evidence,
    rejectionCases: 9}, null, 2));
