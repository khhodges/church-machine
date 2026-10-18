'use strict';
// Authorized initializer for disposable synthetic evidence only. These bytes
// are NOT the independently qualified 17-entry candidates or a live image.
const Simulator = require('../../simulator/simulator');
const Thread = require('../../simulator/thread_design');
const {PROFILE, programs, digest} = require('../../simulator/mint/protected-programs');

function fixture(options = {}) {
    const s = new Simulator(), code = programs(!!options.consumer), memory = new Uint32Array(32768);
    const namespaceId = [0x4d494e54, 0x424f4f54, 1, 1];
    memory[0] = ((31 << 27) | (2 << 23) | (256 << 10) | (1 << 8)) >>> 0;
    // Only five of the reserved initial 17 entries are needed by this isolated
    // fixture. Never count missing qualified candidates as installed services.
    memory[2] = 14; // 5 original + 10 private, excluding Namespace self
    const token = (slot, rights = {}) => s.createGT(0, slot, rights, 1) >>> 0;
    const descriptor = (slot, base, words, gt = token(slot)) => {
        const w1 = s.packNSWord1(words - 1, 0, 0, 0);
        memory.set([base, w1, s._integrity32(base, w1), gt], slot * 4);
    };
    descriptor(1, 0, 1024);
    descriptor(2, 1024, 256);
    descriptor(14, 0, 1024, token(14, {R: 1, W: 1}));
    const views = {
        nstab: token(14, {R: 1, W: 1}),
        resultL: token(18, {L: 1}), resultRW: token(19, {R: 1, W: 1}),
        registry: token(20, {R: 1}), proofSnapshot: token(21, {R: 1}),
        frozenRequest: token(22, {R: 1}), requesterContext: token(23, {R: 1}),
    };
    const proof = options.proof || [0x00112233, 0x44556677, 0x8899aabb, 0xccddeeff];
    const expectedProof = options.expectedProof || [0x00112233, 0x44556677, 0x8899aabb, 0xccddeeff];
    const payload = [0, 0, 0, 0];
    const request = Array(32).fill(0);
    request.splice(0, 12, 0x4d4e5431, 32, 1, 4, 4, 4, 4, 0, ...namespaceId);
    digest(payload).match(/.{8}/g).forEach((w, i) => { request[18 + i] = parseInt(w, 16); });
    memory.set(proof, 1600);
    memory.set(request, 1604);
    memory.set(payload, 1664);
    const privateSlots = [18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
    const rows = [
        [18, 1408, 64], [19, 1471, 1], [20, 1472, 4], [21, 1476, 4],
        [22, 1480, 40], [23, 1520, 12], [24, 1600, 4], [25, 1604, 32],
        [26, 1664, 4], [27, 4096, 4096],
    ];
    rows.forEach(([slot, base, words]) => descriptor(slot, base, words));
    memory[1408] = s.packLumpHeader(0, 0, 2, 0);
    memory[1470] = token(18, {L: 1});
    const mintRows = [token(9, {E: 1}), token(9, {E: 1}), 0x06000000,
        token(24, {R: 1}), token(25, {R: 1}), token(26, {R: 1}),
        token(15, {E: 1}), token(9, {X: 1}), views.nstab, views.resultL, views.resultRW,
        views.proofSnapshot, views.frozenRequest, views.requesterContext];
    if (options.consumer) mintRows.push(token(16, {E: 1}));
    const verifierRows = [token(15, {E: 1}), views.proofSnapshot, views.registry];
    function install(slot, base, words, program, caps) {
        memory[base] = s.packLumpHeader(Math.log2(words) - 6, program.words.length, caps.length, 0);
        memory.set(program.words, base + 1);
        memory.set(caps, base + words - caps.length);
        descriptor(slot, base, words, token(slot, {E: 1}));
        return {slot, base, words, hash: digest(Array.from(memory.slice(base, base + words))),
            descriptor: Array.from(memory.slice(slot * 4, slot * 4 + 4)),
            enter: token(slot, {E: 1}), execute: token(slot, {X: 1})};
    }
    const mint = install(9, 1280, 128, code.mint, mintRows);
    mint.readEntry = code.mint.labels.dispatcher;
    mint.commitEntry = code.mint.labels.commit;
    const verifier = install(15, 2048, 2048, code.verifier, verifierRows);
    memory[1024] = s.packLumpHeader(2, 32, 12, 2);
    const layout = Thread.layout(256, 32);
    memory[1024 + layout.capsStart] = mint.enter;
    memory[1024 + layout.stackEnd - 1] = mint.enter;
    memory[1024 + layout.stackEnd] = s._packFrameWordRaw(0x7fff, 1, layout.stackEnd);
    // Startup resume frame above the retained poison root. Entry activation
    // consumes only this frame; subsequent real CALLs cannot overwrite root.
    memory[1024 + layout.stackEnd - 3] = mint.enter;
    memory[1024 + layout.stackEnd - 2] =
        s._packFrameWordRaw(code.mint.labels[options.method ? `caller_method_${options.method}` : 'caller'],
            1, layout.stackEnd - 2);
    memory[1024 + 17] = s._packProtectedIndicator(layout.stackEnd - 4, 1, {}, 0);
    const plan = {
        profile: PROFILE, consumer: !!options.consumer,
        memory, namespaceId, roles: {mint, verifier}, views,
        root: {word0: token(1), word1: 0, word2: 1023, word3: 0, m: 0},
        threads: [{slot: 2, base: 1024, words: 256}],
        registry: {credential: 0x06000000, owner: 0, recipient: 'ide.Mint',
            issued: true, revoked: false, revision: 1, proof: expectedProof,
            createTypes: [1, 2, 3, 4], replaceTargets: [], destroyTargets: [],
            namespaceId, bindCeiling: 0},
        registryBase: 1472, proofSnapshot: 1476, frozenRequest: 1480,
        requesterContext: 1520, payloadSnapshot: 4096, resultCell: 1471,
        privateSlots, freeSlots: Array.from({length: 228}, (_, i) => i + 28),
        allocationStart: 8192, allocationEnd: 16384,
        privateRanges: [
            {base: 0, words: 1024, roles: ['mint']},
            {base: 1280, words: 128, roles: ['mint']},
            {base: 2048, words: 2048, roles: ['verifier', 'mint']},
            ...rows.filter(([slot]) => slot !== 19).map(([slot, base, words]) =>
                ({base, words, roles: [20, 21, 22, 23].includes(slot) ? ['mint', 'verifier'] : ['mint'],
                    scratch: [21, 22, 23, 27].includes(slot)})),
        ],
        faultAt: options.faultAt,
    };
    return plan;
}
function unrelatedCaller(plan, slot = 16) {
    const Assembler = require('../../simulator/assembler');
    const s = new Simulator(), a = new Assembler();
    const code = a.assemble('LOAD CR0, CR6, #1\nCALL CR0, #0\nHALT').words;
    const gt = s.createGT(0, slot, {E: 1}, 1) >>> 0;
    const base = 1728, limit = 63;
    plan.memory[base] = s.packLumpHeader(0, code.length, 2, 0);
    plan.memory.set(code, base + 1);
    plan.memory.set([gt, plan.roles.mint.enter], base + 62);
    plan.memory.set([base, limit, s._integrity32(base, limit), gt], slot * 4);
    plan.memory[2]++;
    const layout = Thread.layout(256, 32), t = 1024;
    plan.memory[t + layout.capsStart] = gt;
    plan.memory[t + layout.stackEnd - 1] = gt;
    plan.memory[t + layout.stackEnd - 3] = gt;
    plan.memory[t + layout.stackEnd - 2] = s._packFrameWordRaw(0, 1, layout.stackEnd - 2);
    return plan;
}
module.exports = {fixture, unrelatedCaller};
