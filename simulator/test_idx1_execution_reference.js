'use strict';

// Synthetic fixtures only. This is not executable-envelope admission evidence.
const assert = require('node:assert/strict');
const Simulator = require('./simulator.js');
const codec = require('./idx1.js');
const d = (register, magnitude = 0, subtract = false) => ({ register, magnitude, subtract });
const w = (op, a = 0, b = 0, immediate = 0, condition = 14) =>
    ((op << 27) | (condition << 23) | (a << 19) | (b << 15) | immediate) >>> 0;
function fixture(words, overrides = {}) {
    const events = [];
    const state = { pc: 0, flags: { N: false, Z: false, C: false, V: false },
        dr: Array(16).fill(0) };
    const adapter = {
        capture: () => state,
        authorizeCode: () => { events.push('code'); return true; },
        codeMetadata: () => ({ profile: 'IDX1', extents: [{ start: 0, end: 8 }],
            starts: [0, words.length, 6] }),
        fetchWord: pc => { events.push(`fetch:${pc}`); return words[pc]; },
        authorizeSource: () => { events.push('source'); return true; },
        sourceMetadata: () => { events.push('limit'); return { limit: 4, base: 100 }; },
        authorizeCallee: () => { events.push('callee'); return true; },
        calleeMetadata: () => { events.push('dispatch'); return {
            fastEntry: 20, extents: [{ start: 20, end: 24 }], starts: [20, 22],
            dispatch: [{ selector: 1, kind: 'offset', target: 22 },
                { selector: 2, kind: 'private' }] }; },
        authorizeSelected: () => { events.push('selected'); return true; },
        commit: result => { events.push('commit'); state.pc = result.nextPC; },
        ...overrides,
    };
    return { state, events, adapter, harness: Simulator.createIDX1ReferenceHarness(codec, adapter) };
}
function fails(f, code) {
    assert.throws(() => f.harness.step(), error => error.code === code);
    assert(!f.events.includes('commit'));
    assert.equal(f.state.pc, 0);
}
assert.throws(() => Simulator.admitIDX1Execution({ profile: 'IDX1' }),
    { code: 'UNSUPPORTED_PROFILE' });

// Every source-role family, boundary success/failure and distinct CHANGE units.
for (const [op, a, b, imm, role] of [
    [0, 1, 6, 0, 'clist-row'], [1, 6, 1, 0, 'clist-row'],
    [5, 12, 6, 0, 'clist-row'], [4, 12, 1, 0, 'source-word'],
    [4, 14, 1, 0, 'namespace-ordinal'], [16, 1, 2, 0x4000, 'data-word'],
    [17, 1, 2, 0x4000, 'data-word'],
]) {
    const words = codec.encodePacket({ w1: w(op, a, b, imm), role0: d(1) });
    const f = fixture(words, { authorizeSource: (state, packet, actual) => {
        assert.equal(actual, role); return true;
    } });
    f.state.dr[1] = 3;
    const result = f.harness.step();
    assert.equal(result.values.role0, 3);
    assert.equal(result.values.address, role === 'namespace-ordinal' ? 112 : 103);
    assert.equal(result.nextPC, 2);
    assert.equal(f.events.filter(e => e === 'commit').length, 1);
    const bad = fixture(words);
    bad.state.dr[1] = 4;
    fails(bad, 'CONTAINMENT');
    assert(!bad.events.includes('selected'));
    const denied = fixture(words, { authorizeSource: () => false });
    denied.state.dr[1] = 0xFFFFFFFF;
    fails(denied, 'AUTHORITY');
    assert(!denied.events.includes('limit'));
}
const load = codec.encodePacket({ w1: w(0, 1, 6), role0: d(1, 1) });
const overflow = fixture(load);
overflow.state.dr[1] = 0xFFFFFFFF;
fails(overflow, 'INDEX_ARITHMETIC');
assert(!overflow.events.includes('limit'));
const large = fixture(load, { sourceMetadata: () => ({ limit: 0x100000000, base: 0 }) });
large.state.dr[1] = 0x80000000;
assert.equal(large.harness.step().values.role0, 0x80000001);
const stable = fixture(load, { authorizeSource: () => {
    stable.state.dr[1] = 0xFFFFFFFF; return true;
} });
stable.state.dr[1] = 2;
assert.equal(stable.harness.step().values.role0, 3);

fails(fixture(codec.encodePacket({ w1: w(1, 6, 1), role0: d(0) }),
    { sourceMetadata: () => { throw Error('SELF precedes count'); } }), 'IMMUTABLE_SELF_CAP');
const nv = fixture(codec.encodePacket({ w1: w(0, 1, 6, 0, 15), role0: d(1, 1, true) }));
assert.equal(nv.harness.step().executed, false);
assert(!nv.events.includes('source'));
assert.equal(nv.state.pc, 2);
const crossing = fixture(load, { codeMetadata: () => ({
    profile: 'IDX1', extents: [{ start: 0, end: 1 }], starts: [0] }) });
fails(crossing, 'FETCH');
assert.deepEqual(crossing.events, ['code', 'fetch:0']);
const interior = fixture(load, { codeMetadata: () => ({
    profile: 'IDX1', extents: [{ start: 0, end: 8 }], starts: [0, 1, 2] }) });
fails(interior, 'STRUCTURE');
assert(!interior.events.includes('fetch:1'));
for (const op of [18, 19]) {
    const words = codec.encodePacket({ w1: w(op, 1, 2, 8), role0: d(1) });
    const good = fixture(words); good.state.dr[1] = 24; good.harness.step();
    const bad = fixture(words); bad.state.dr[1] = 25; fails(bad, 'CONTAINMENT');
}
const branch = fixture(codec.encodePacket({ w1: w(23), role0: d(1) }));
branch.state.dr[1] = 2;
assert.equal(branch.harness.step().nextPC, 2);
const badBranch = fixture(codec.encodePacket({ w1: w(23), role0: d(0, 1) }));
fails(badBranch, 'CONTAINMENT');

for (const mask of [1, 2, 3]) {
    const words = codec.encodePacket({ w1: w(2, 0, 6, mask === 1 ? 32 : mask === 2 ? 3 : 0),
        ...(mask & 1 ? { role0: d(1) } : {}),
        ...(mask & 2 ? { role1: d(2) } : {}) });
    const f = fixture(words); f.state.dr[1] = 3; f.state.dr[2] = 1;
    const plan = f.harness.plan();
    assert.equal(plan.values.role0, 3);
    assert.equal(plan.values.role1, 1);
    assert.equal(plan.continuation, words.length);
    assert.equal(plan.nextPC, 22);
    fails(f, 'UNSUPPORTED_PROFILE'); // No invented CALL frame/profile cache.
}
const dual = codec.encodePacket({ w1: w(2, 0, 6), role0: d(1), role1: d(2, 1) });
const badMethod = fixture(dual); badMethod.state.dr[1] = 3; badMethod.state.dr[2] = 0xFFFFFFFF;
fails(badMethod, 'INDEX_ARITHMETIC');
assert(!badMethod.events.includes('callee'));
const direct = fixture(codec.encodePacket({ w1: w(2, 3), role1: d(1) }),
    { authorizeCallee: () => false });
direct.state.dr[1] = 999;
fails(direct, 'AUTHORITY');
assert(!direct.events.includes('dispatch'));
const privateCall = fixture(codec.encodePacket({ w1: w(2, 3), role1: d(0, 2) }));
fails(privateCall, 'PRIVATE_METHOD');
console.log('IDX1 isolated reference synthetic tests passed (runtime admission remains unsupported)');