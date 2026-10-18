'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {fixture, unrelatedCaller} = require('./protected_fixture');
const {provision, PROFILE} = require('../../simulator/mint/protected-runtime');
const {programs, compile, digest} = require('../../simulator/mint/protected-programs');
const Simulator = require('../../simulator/simulator');
const Assembler = require('../../simulator/assembler');
const {useFixture} = require('./protected_use_fixture');

function run(plan, until = state => state.halted) {
    const runtime = provision(plan);
    for (let i = 0; i < 20001; i++) {
        const state = runtime.step();
        if (until(state) || state.halted) return {runtime, state};
    }
    assert.fail('Protected machine did not terminate within its watchdog');
}
function negative(kind, at, extra = {}, expected) {
    const p = fixture();
    p.negativeProbe = {kind, at, ...extra};
    const {runtime, state} = run(p);
    assert(state.halted && state.quarantined, `${kind}: ${JSON.stringify(state)}`);
    if (expected) assert.equal(state.fault, expected);
    assert.equal(state.result, 0);
    assert.equal(state.useConfirmed, false);
    assert.deepEqual(runtime.step(), state, 'no continuation after fault');
    return state;
}

test('real compiled caller → Mint → PkVerify → linked Lambda → LOAD → actual use, twice', () => {
    const p = fixture(), before = digest(Array.from(p.memory));
    const {state} = run(p);
    assert.equal(state.fault, null);
    assert.equal(state.useConfirmed, true);
    assert.equal(state.admissions, 2);
    assert.equal(state.publications, 2);
    assert.equal(state.completedWrites, 8);
    assert.equal(state.lambdaEntries, 4);
    assert.equal(state.protectedReturns, 8);
    assert.equal(state.comparedWords, 8);
    assert.equal(state.privateDescriptors, 10);
    assert.equal(state.result, 0x3200001d);
    assert.equal(digest(Array.from(p.memory)), before, 'initializer bytes were not modified');
});

test('opcode 11 is explicit and opt-in; IDX1 and legacy CALL/WORD meanings remain intact', () => {
    const {mint, verifier} = programs(), s = new Simulator(), a = new Assembler();
    assert.equal(PROFILE, 'mint-protected-sim-v1');
    assert(mint.words.some(w => w >>> 27 === 11));
    assert(!mint.words.some(w => w >>> 27 === 10));
    assert(verifier.words.some(w => w >>> 27 === 11));
    assert.equal(a.assemble('CALL CR0, #0').words[0] & 0x7fff, 1);
    assert.equal(a.assemble('WORD 1').words[0] >>> 27, 30);
    assert.throws(() => compile('WORD 1'), /Raw WORD/);
    // The normal decoder identifies the reserved opcode; it is not relabelled
    // as an ordinary published instruction.
    assert.equal(s.decodeInstruction(mint.words[mint.labels.create]).opcode, 11);
});

test('all-zero complete proof remains valid when independently provisioned as such', () => {
    const {state} = run(fixture({proof: [0, 0, 0, 0], expectedProof: [0, 0, 0, 0]}));
    assert.equal(state.fault, null);
    assert(state.useConfirmed);
});

test('every proof word and both end bits participate; mismatch position does not change work', () => {
    let steps;
    for (let word = 0; word < 4; word++) for (const bit of [1, 0x80000000]) {
        const p = fixture();
        p.memory[1600 + word] ^= bit;
        const {state} = run(p);
        assert.equal(state.fault, 'MINT_DENIED');
        assert.equal(state.publications, 0);
        assert.equal(state.completedWrites, 0);
        if (steps !== undefined) assert.equal(state.steps, steps);
        steps = state.steps;
    }
});

test('registry expectation is independent of client buffer, and missing/revoked issuance rejects', () => {
    const p = fixture({expectedProof: [9, 8, 7, 6]});
    assert.equal(run(p).state.fault, 'MINT_DENIED');
    for (const change of [{revoked: true}, {issued: false}]) {
        const p = fixture(); Object.assign(p.registry, change);
        assert.equal(run(p).state.fault, 'MINT_CREDENTIAL');
    }
});

test('Alice and Mallory can call the public entry but neither acquires Mint recipient authority', () => {
    for (const slot of [16, 17]) {
        const {state} = run(unrelatedCaller(fixture(), slot));
        assert.equal(state.fault, 'MINT_REQUESTER');
        assert.equal(state.completedWrites, 0);
    }
});

test('unrelated initializer edits cannot mutate frozen RAM or trusted issuance after provisioning', () => {
    const p = fixture(), {runtime, state} = run(p, s => s.phase === 'read');
    assert.equal(state.phase, 'read');
    p.memory.fill(0);
    p.registry.proof.fill(0);
    p.registry.revoked = true;
    p.roles.mint.hash = 'forged';
    let final;
    do { final = runtime.step(); } while (!final.halted);
    assert.equal(final.fault, null);
    assert(final.useConfirmed);
});

test('identity, links, rights, geometry, aliases and grants fail closed at provisioning', () => {
    const mutations = [
        p => p.memory[p.roles.mint.base + 1] ^= 1,
        p => p.memory[p.roles.verifier.base + 2] ^= 1,
        p => { p.roles.mint.hash = '0'.repeat(64); },
        p => { p.roles.mint.readEntry++; },
        p => { p.roles.mint.commitEntry = 8191; },
        p => { p.roles.mint.slot = 16; },
        p => { p.views.resultL ^= 0x20000000; },
        p => { p.registry.recipient = 'ide.Alice'; },
        p => { p.registry.owner = 1; },
        p => { p.registry.replaceTargets = [28]; },
        p => { p.registry.destroyTargets = [28]; },
        p => { p.registry.bindCeiling = 1; },
        p => { p.registry.proof.pop(); },
        p => { p.freeSlots.push(9); },
        p => { p.freeSlots.push(p.freeSlots[0]); },
        p => { p.allocationEnd = 32768; },
        p => { p.threads = []; },
        p => { p.resultCell--; },
        p => { p.memory[p.resultCell] = 0x3200001c; },
        p => { p.profile = 'LEGACY'; },
    ];
    for (const mutate of mutations) {
        const p = fixture(); mutate(p);
        assert.throws(() => provision(p), /MINT_/);
    }
});

test('input shape, scope, rights, payload hash and allocation bounds reject before publication', () => {
    for (const [offset, value] of [[0, 0], [1, 31], [2, 2], [3, 5], [4, 5],
        [5, 3], [5, 8192], [6, 1], [7, 1], [8, 99], [12, 1], [16, 1],
        [17, 28], [18, 1], [26, 1], [31, 1]]) {
        const p = fixture(); p.memory[1604 + offset] = value;
        const {state} = run(p);
        assert(state.fault, `accepted malformed word ${offset}`);
        assert.equal(state.completedWrites, 0);
    }
});

test('all four granted types produce their declared CR-held rights, with validated payload framing', () => {
    const s = new Simulator(), Thread = require('../../simulator/thread_design');
    for (const type of [1, 2, 3, 4]) {
        const p = fixture(), size = type === 2 ? 256 : type === 4 ? 4 : 64;
        const payload = Array(size).fill(0);
        if (type === 1) {
            const a = new Assembler();
            const program = a.assemble('BRANCH entry\nentry:\nRETURN').words;
            payload[0] = s.packLumpHeader(0, program.length, 1, 0);
            program.forEach((v, i) => { payload[i + 1] = v; });
        } else if (type === 3) payload[0] = s.packLumpHeader(0, 0, 1, 0);
        else if (type === 2) {
            payload[0] = s.packLumpHeader(2, 32, 12, 2);
            const l = Thread.layout(256, 32);
            payload[l.stackEnd - 1] = p.roles.mint.enter;
            payload[l.stackEnd] = s._packFrameWordRaw(0x7fff, 1, l.stackEnd);
            payload[17] = s._packProtectedIndicator(l.stackEnd - 2, 1, {}, 0);
            payload[l.capsStart] = p.roles.mint.enter;
        }
        p.memory.set(payload, 1664);
        p.memory.set([1664, size - 1, s._integrity32(1664, size - 1), 0x0200001a], 26 * 4);
        p.memory[1607] = type;
        p.memory[1608] = size;
        p.memory[1609] = size;
        p.memory[1610] = type;
        digest(payload).match(/.{8}/g).forEach((w, i) => { p.memory[1622 + i] = parseInt(w, 16); });
        const {state} = run(p, state => state.protectedReturns === 4 && state.phase === 'idle');
        assert.equal(state.fault, null, `type ${type}: ${JSON.stringify(state)}`);
        assert.equal(state.protectedReturns, 4);
        const rights = [{}, {E: 1}, {L: 1, S: 1}, {L: 1, S: 1}, {R: 1, W: 1}][type];
        const expected = type === 2 || type === 3
            ? (s.createGT(0, 28, {L: 1}, 1) | s.createGT(0, 28, {S: 1}, 1)) >>> 0
            : s.createGT(0, 28, rights, 1) >>> 0;
        assert.equal(state.result, expected);
    }
});

test('combined LS is isolated; E combinations, mixed domains and legacy parsing stay rejected', () => {
    const Profile = require('../../simulator/mint/combined-ls-profile')(Simulator);
    const isolated = new Profile(), legacy = new Simulator();
    for (const B of [0, 1]) {
        const gt = isolated.createGT(7, 28, {L: 1, S: 1, B}, 1);
        assert.equal(gt, (legacy.createGT(7, 28, {L: 1, B}, 1) |
            legacy.createGT(7, 28, {S: 1, B}, 1)) >>> 0);
        assert.equal(isolated.parseGT(gt).malformed, false);
        assert.equal(isolated.parseGT(gt).permissions.B, B);
        assert.equal(legacy.parseGT(gt).malformed, true);
        assert.throws(() => legacy.createGT(7, 28, {L: 1, S: 1, B}, 1), /single-Church/);
        assert.throws(() => isolated.createGT(7, 28, {L: 1, S: 1, E: 1, B}, 1), /single-Church/);
        assert.equal(isolated.parseGT(gt | 0x40000000).malformed, true);
        assert.throws(() => isolated.createGT(7, 28, {L: 1, S: 1, R: 1, B}, 1), /domain-impure/);
    }
    for (const type of [0, 2, 3]) {
        assert.throws(() => isolated.createGT(0, 28, {L: 1, S: 1}, type), /single-Church/);
    }
});

// A real Mint caller admits the request and returns CR1 first. Only then does
// it CALL the ordinary consumer; consumers have no private Mint capabilities.
function consume(type, source, fault = null, options = {}) {
    const plan = useFixture(type, source, options), before = digest(Array.from(plan.memory));
    const {runtime, state: returned} = run(plan,
        state => state.protectedReturns === 4 && state.phase === 'idle');
    assert.equal(returned.fault, null, JSON.stringify(returned));
    assert.equal(returned.protectedReturns, 4);
    assert.equal(returned.halted, false);
    assert.equal(returned.result, 0x3a00001c, 'one combined LS result, B=0, in slot 28');
    let state = returned;
    while (!state.halted) state = runtime.step();
    assert.equal(state.fault, fault, JSON.stringify(state));
    assert.equal(state.quarantined, fault !== null);
    assert.equal(state.admissions, 1);
    assert.equal(state.publications, 1);
    assert.equal(state.completedWrites, 4);
    assert.equal(state.protectedReturns, 4, 'consumer must execute, not return to the driver HALT');
    assert.equal(state.useConfirmed, false, 'RW-only telemetry is not LS-use evidence');
    assert.equal(state.result, fault ? 0 : returned.result);
    assert.deepEqual(runtime.step(), state);
    assert.deepEqual(runtime.control('snapshot'), state);
    assert.equal(digest(Array.from(plan.memory)), before, 'no host mutation after admission');
    return {runtime, state};
}

test('returned LS supports ordinary LOAD and SAVE with a separately held B=1 source', () => {
    consume(3, `
TPERM CR1, LS
BRANCHNE failed
TPERM CR2, NULL
BRANCHNE failed
LOAD CR4, CR1, #0
TPERM CR4, EXACT, CR1
BRANCHNE failed
LOAD CR2, CR1, #1
LOAD CR3, CR6, #4
TPERM CR2, EXACT, CR3
BRANCHNE failed
LOAD CR2, CR6, #1
TPERM CR2, EXACT, CR3
BRANCHEQ failed
SAVE CR2, CR1, #1
LOAD CR3, CR1, #1
TPERM CR3, EXACT, CR2
BRANCHNE failed
LOAD CR4, CR1, #0
TPERM CR4, EXACT, CR1
BRANCHNE failed`);
});

test('returned B=0 LS cannot be copied as a SAVE source, including its loaded SELF', () => {
    consume(3, 'SAVE CR1, CR1, #1', 'BIND');
    consume(3, 'LOAD CR2, CR1, #0\nSAVE CR2, CR1, #1', 'BIND');
    consume(3, 'LOAD CR2, CR6, #1\nTPERM CR2, EB\nBRANCHNE failed\nSAVE CR2, CR1, #1',
        'BIND');
});

test('LS SAVE still protects SELF and enforces declared c-list bounds', () => {
    assert.throws(() => useFixture(3, 'LOAD CR2, CR6, #1\nSAVE CR2, CR1, #0'),
        /immutable SELF/);
    consume(3, 'LOAD CR2, CR6, #1\nSAVE CR2, CR1, #2', 'BOUNDS');
    consume(3, 'LOAD CR2, CR1, #2', 'NO_CAPABILITY');
});

test('isolated compiler lowers existing TPERM Mode 2 without changing preset or legacy assembly', () => {
    const source = 'TPERM CR1, CR2, #32767';
    const word = ((6 << 27) | (14 << 23) | (1 << 19) | (2 << 15) | 0x7fff) >>> 0;
    assert.deepEqual(compile(source).words, [word]);
    assert.deepEqual(compile(`MINT BEGIN\n${source}\nMINT FINISH`).words,
        [((11 << 27) | (14 << 23) | 1) >>> 0, word, ((11 << 27) | (14 << 23) | 8) >>> 0]);
    assert.deepEqual(compile('TPERM CR1, LS').words, new Assembler().assemble('TPERM CR1, LS').words);
    assert.notEqual(new Assembler().assemble(source).words[0], word);
    assert.throws(() => compile('WORD 0'), /Raw WORD/);
});

test('consumer evidence profile still requires canonical service bytes and unchanged credential grants', () => {
    for (const mutate of [
        p => { p.consumer = 'true'; },
        p => { p.consumer = false; },
        p => { p.registry.bindCeiling = 1; },
        p => { p.registry.recipient = 'ide.Alice'; },
        p => {
            p.memory[p.roles.mint.base + 2] ^= 1;
            p.roles.mint.hash = digest(Array.from(p.memory.slice(
                p.roles.mint.base, p.roles.mint.base + p.roles.mint.words)));
        },
    ]) {
        const p = useFixture(3, 'TPERM CR1, LS\nBRANCHNE failed');
        mutate(p);
        assert.throws(() => provision(p), /MINT_/);
    }
    consume(3, 'MINT BEGIN', 'MINT_IDENTITY');
    consume(3, 'LOAD CR0, CR6, #4\nCALL CR0, #0', 'MINT_REQUESTER');
});

test('LS attenuation retains permitted use, removes the other operation and cannot expand rights', () => {
    const attenuate = (row, preset) => `
LOAD CR2, CR6, #${row}
TPERM CR1, CR2, #32767
BRANCHNE failed
TPERM CR1, ${preset}
BRANCHNE failed`;
    consume(3, `${attenuate(2, 'L')}\nLOAD CR3, CR1, #1`);
    consume(3, `${attenuate(2, 'L')}\nLOAD CR2, CR6, #1\nSAVE CR2, CR1, #1`, 'PERMISSION');
    consume(3, `${attenuate(3, 'S')}\nLOAD CR2, CR6, #1\nSAVE CR2, CR1, #1`);
    consume(3, `${attenuate(3, 'S')}\nLOAD CR3, CR1, #1`, 'PERMISSION');
    consume(3, `
LOAD CR4, CR1, #0
LOAD CR2, CR6, #1
TPERM CR1, CR2, #32767
BRANCHEQ failed
TPERM CR1, EXACT, CR4
BRANCHNE failed
TPERM CR1, LS
BRANCHNE failed`);
    consume(3, `${attenuate(2, 'L')}\nSAVE CR1, CR1, #1`, 'BIND');
});

test('returned Thread-LS never grants raw LOAD/SAVE access to protected capability homes', () => {
    consume(2, 'LOAD CR2, CR1, #0', 'MINT_PRIVATE');
    consume(2, 'LOAD CR2, CR6, #1\nSAVE CR2, CR1, #1', 'MINT_PRIVATE');
    consume(2, 'SAVE CR1, CR1, #1', 'BIND');
    consume(2, 'LOAD CR2, CR6, #2\nTPERM CR1, CR2, #32767\nBRANCHNE failed\nLOAD CR3, CR1, #0',
        'MINT_PRIVATE');
    consume(2, `LOAD CR2, CR6, #3
TPERM CR1, CR2, #32767
BRANCHNE failed
LOAD CR2, CR6, #1
SAVE CR2, CR1, #1`, 'MINT_PRIVATE');
});

test('returned Thread-LS cannot read or overwrite DR homes, indicator, frames or CR homes', () => {
    const layout = require('../../simulator/thread_design').layout(256, 32);
    for (const offset of [1, 16, 17, layout.stackEnd - 1, layout.stackEnd, layout.capsStart]) {
        consume(2, `DREAD DR2, CR1, #${offset}`, 'MINT_PRIVATE');
        consume(2, `DWRITE DR0, CR1, #${offset}`, 'MINT_PRIVATE');
    }
});

test('Thread activation remains fail-closed: LS is not CHANGE authority, and a root is not a resume frame', () => {
    consume(2, 'CHANGE CR1', 'THREAD_PERMISSIONS');
    // CR2 is NULL after the single-CR1 service return. Mode 2 attenuates the
    // actual returned GT to permission-free identity without a host CR write.
    // This satisfies CHANGE's GT rule, but cannot invent a legal continuation.
    consume(2, `
TPERM CR2, NULL
BRANCHNE failed
TPERM CR1, CR2, #32767
BRANCHNE failed
CHANGE CR1`, 'THREAD_CONTEXT');
});

const changeReturnedThread = `
TPERM CR2, NULL
BRANCHNE failed
TPERM CR1, CR2, #32767
BRANCHNE failed
CHANGE CR1
MINT FAIL`;

test('returned Thread activates by one CHANGE, uses its own heap and CR6, then self-CHANGE resumes once', () => {
    consume(2, changeReturnedThread, null, {threadSource: `
IADD DR2, DR0, #73
DWRITE DR2, CR5, #0
DREAD DR3, CR5, #0
MCMP DR2, DR3
BRANCHNE failed
LOAD CR4, CR6, #0
TPERM CR4, E
BRANCHNE failed
CHANGE CR12
DREAD DR3, CR5, #0
IADD DR2, DR0, #73
MCMP DR2, DR3
BRANCHNE failed
LOAD CR4, CR6, #0
TPERM CR4, E
BRANCHNE failed`});
});

test('CHANGE microcode authority does not expose the active Thread homes or frames to instructions', () => {
    for (const instruction of ['DREAD DR2, CR12, #17', 'DWRITE DR0, CR12, #17']) {
        assert.throws(() => useFixture(2, changeReturnedThread, {threadSource: instruction}),
            /Privilege Zone/);
    }
    // Compilable heap access beyond CR5's architectural extent must not read
    // the active Thread's protected stack, even immediately after CHANGE.
    consume(2, changeReturnedThread, 'MINT_PRIVATE', {threadSource: 'DREAD DR2, CR5, #225'});
    consume(2, changeReturnedThread, 'MINT_PRIVATE', {threadSource: 'DWRITE DR0, CR5, #225'});
    // Restoring CR6.M supplies L without transferring M to a loaded E-GT.
    consume(2, changeReturnedThread, 'PERMISSION', {
        threadSource: 'LOAD CR4, CR6, #0\nLOAD CR2, CR4, #0',
    });
});

test('CR6 M authorizes L/S only for that register, without export or private-write authority', () => {
    consume(3, 'LOAD CR2, CR6, #1\nSAVE CR2, CR6, #1', 'MINT_WRITE');
    consume(3, 'LOAD CR2, CR6, #1\nLOAD CR4, CR6, #0\nSAVE CR2, CR4, #1', 'PERMISSION');
    consume(3, 'SAVE CR1, CR6, #1', 'BIND');
    consume(3, 'DREAD DR2, CR6, #0', 'PERMISSION');
    consume(3, 'DWRITE DR0, CR6, #0', 'PERMISSION');
});

test('isolated CHANGE uses the master fixed-destination encoding and excludes reserved CR13', () => {
    assert.deepEqual(compile('CHANGE CR12').words, [0x27060000]);
    assert.deepEqual(compile('CHANGE CR1').words, [0x27008000]);
    assert.notEqual(new Assembler().assemble('CHANGE CR12').words[0], 0x27060000);
    consume(2, 'CHANGE CR13', 'INVALID_OP');
});

test('Thread payload admission rejects malformed or unheld continuations without repairing them', () => {
    const s = new Simulator(), layout = require('../../simulator/thread_design').layout(256, 32);
    const base = 1664;
    for (const [mutate, fault] of [
        [p => { p.memory[base + 17] = s._packProtectedIndicator(layout.stackStart - 2, 1, {}, 0); }, 'MINT_THREAD'],
        [p => { p.memory[base + layout.stackEnd - 2] = s._packFrameWordRaw(0, 0, layout.stackEnd - 2); }, 'MINT_THREAD'],
        [p => { p.memory[base + layout.stackEnd - 2] = s._packFrameWordRaw(8191, 1, layout.stackEnd - 2); }, 'MINT_THREAD'],
        [p => { p.memory[base + layout.stackEnd - 2] = s._packFrameWordRaw(0, 1, layout.stackEnd); }, 'MINT_THREAD'],
        [p => { p.memory[base + layout.stackEnd] = s._packFrameWordRaw(0, 1, layout.stackEnd); }, 'MINT_THREAD'],
        [p => { p.memory[base + layout.stackEnd - 3] = p.roles.verifier.enter; }, 'MINT_PAYLOAD_CAPABILITY'],
        [p => { p.memory[base + layout.stackEnd - 3] = s.createGT(0, 16, {E: 1, B: 1}, 1); }, 'MINT_PAYLOAD_CAPABILITY'],
        [p => { p.memory[base + layout.capsStart + 1] = p.views.registry; }, 'MINT_PAYLOAD_CAPABILITY'],
    ]) {
        const p = useFixture(2, changeReturnedThread, {threadSource: 'HALT'});
        mutate(p);
        digest(Array.from(p.memory.slice(base, base + 256))).match(/.{8}/g)
            .forEach((w, i) => { p.memory[1622 + i] = parseInt(w, 16); });
        const {runtime, state} = run(p);
        assert.equal(state.fault, fault);
        assert.equal(state.publications, 0);
        assert.equal(state.completedWrites, 0);
        assert.equal(state.result, 0);
        assert.deepEqual(runtime.step(), state);
    }
});

test('exhausted slots and blocks do not wrap, replace existing entries, or fall back', () => {
    const p = fixture(); p.freeSlots = [];
    assert.equal(run(p).state.fault, 'MINT_EXHAUSTED');
    const one = fixture(); one.allocationEnd = one.allocationStart + 4;
    const state = run(one).state;
    assert.equal(state.fault, 'MINT_EXHAUSTED');
    assert.equal(state.publications, 1);
    assert.equal(state.completedWrites, 4);
});

test('all four old words are individually bound across READ and COMMIT', () => {
    for (let word = 0; word < 4; word++) {
        const state = negative('wrong-old-word', 'read', {word}, 'MINT_OLD_WORDS');
        assert.equal(state.completedWrites, 0);
    }
});

test('dropped publication writes are found by actual RAM readback, not echoed payload', () => {
    // The fourth word is nonzero too; all four independently distinguish the
    // new descriptor from the all-zero old entry.
    for (let word = 0; word < 4; word++) {
        const p = fixture(); p.dropPublicationWord = word;
        const state = run(p).state;
        assert.equal(state.fault, 'MINT_READBACK');
        assert.equal(state.publications, 0);
        assert.equal(state.result, 0);
    }
});

test('ABA, request aliases, overlapping admission and Thread/Namespace activation are excluded', () => {
    negative('aba', 'read', {}, 'MINT_EXCLUSION');
    negative('write-request', 'verifying', {}, 'MINT_EXCLUSION');
    negative('overlap', 'read', {}, 'MINT_OVERLAP');
    negative('activation', 'read', {}, 'MINT_ACTIVATION');
    negative('switch', 'read', {}, 'MINT_ACTIVATION');
    negative('stale-registry', 'verified-return', {}, 'MINT_CONTEXT');
});

test('a corrupted real Lambda continuation cannot return using callStack or a cached PC', () => {
    negative('corrupt-continuation', 'read-lambda', {}, 'STACK_CORRUPT');
});

test('live-use traversal includes suspended Threads and rejects missing/corrupt frame chains', () => {
    for (const corrupt of [false, true]) {
        const p = fixture(), s = new Simulator();
        const base = 1792, slot = 11, words = 256;
        p.memory.set(p.memory.slice(1024, 1280), base);
        p.memory.set([base, words - 1, s._integrity32(base, words - 1), 0x0200000b], slot * 4);
        p.memory[2]++;
        p.threads.push({slot, base, words});
        if (corrupt) p.memory[base + 241] ^= 1; // actual pending resume frame STO
        const {state} = run(p);
        assert.equal(state.fault, corrupt ? 'MINT_LIVE_CONTEXT' : null);
        assert.equal(state.useConfirmed, !corrupt);
        if (corrupt) assert.equal(state.completedWrites, 0);
    }
});

test('publication permits reject early, duplicate, wrong-value, NULL and wrong-word writes across aliases', () => {
    negative('early-result', 'read', {}, 'MINT_RESULT_WRITE');
    negative('duplicate-result', 'written-lambda', {}, 'MINT_RESULT_WRITE');
    negative('wrong-result', 'published-lambda', {}, 'MINT_RESULT_WRITE');
    negative('zero-result', 'published-lambda', {}, 'MINT_RESULT_WRITE');
    negative('wrong-address', 'published-lambda', {}, 'MINT_EXCLUSION');
    negative('alias-result', 'published-lambda', {}, 'MINT_RESULT_WRITE');
});

test('old verification/publication context cannot be replayed after FINISH', () => {
    negative('replay', 'finished', {}, 'MINT_CONTEXT');
});

test('fault cuts never complete unaccepted writes or allow result reuse before/after clearing', () => {
    for (const point of ['write-0', 'write-1', 'write-2', 'write-3',
        'published', 'result-written', 'loaded', 'clean']) {
        const {runtime, state} = run(fixture({faultAt: point}));
        assert.equal(state.fault, 'MINT_INJECTED', point);
        assert.equal(state.result, 0);
        assert(state.quarantined);
        assert.deepEqual(runtime.step(), state);
        assert.deepEqual(runtime.control('snapshot'), state);
        assert(runtime.control('reset').quarantined);
        assert.equal(runtime.step().result, 0);
        if (point.startsWith('write-')) {
            assert.equal(state.completedWrites, Number(point.slice(-1)) + 1);
            assert.equal(state.publications, 0);
        }
    }
});

test('every external loader/mutator/activation path is unavailable through the sealed facade', async () => {
    const names = ['memory', 'cr', 'dr', 'callStack', 'getState', 'on', 'loadProgram',
        'loadLumpBinary', 'loadHardwareBinary', 'loadBootImage', 'loadImageFromBinary',
        'activateSimulationConfiguration', 'resetPreparedSimulation', 'writePersistentWord',
        'writeNSEntry', 'clearNSEntry', 'withNamespaceWrite', 'withNamespaceSave',
        'receiveLump', 'resolvePendingSlot', 'lazyLoad', 'lazyEvict', 'runGC',
        'resetThreadToBaseline', 'selectConfiguredThread', 'advanceConfiguredThread',
        '_fireSchedulerIRQ', '_returnToBoot', '_fastBoot', 'snapshotPersistentMemory'];
    const {runtime, state} = run(fixture(), s => s.phase === 'read');
    assert(Object.isFrozen(runtime));
    for (const name of names) assert.equal(runtime[name], undefined, name);
    const captured = runtime.control('snapshot');
    assert(Object.isFrozen(captured));
    assert.equal(captured.result, 0);
    assert(!JSON.stringify(captured).includes('112233'));
    assert.deepEqual(runtime.control('pause'), state, 'pause does not release admission');
    const after = await Promise.resolve().then(() => runtime.control('loadBootImage'));
    assert.equal(after.fault, 'MINT_EXCLUSION');
    assert.equal(after.completedWrites, 0);
    assert.deepEqual(captured, state, 'previously emitted status contains no mutable/private reference');
});

test('all five selectors share admission; empty Replace/Destroy and unapproved admin stay denied', () => {
    for (let method = 2; method <= 5; method++) {
        const {state} = run(fixture({method}));
        assert.equal(state.fault, method <= 3 ? 'MINT_TARGET_GRANT' : 'MINT_ADMIN');
        assert.equal(state.completedWrites, 0);
    }
});
