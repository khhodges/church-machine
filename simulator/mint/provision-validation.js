'use strict';
const Simulator = require('../simulator');
const {PROFILE, programs, digest} = require('./protected-programs');
const {requireThat: need, equal} = require('./protected-policy');

// This validates the initializer's output, not an authorization token obtained
// from an ordinary caller. No filename, slot label or supplied hash alone
// authenticates a role: both complete bytes and canonical executable code match.
function validate(p) {
    need(p.profile === PROFILE && p.memory instanceof Uint32Array, 'MINT_PROFILE');
    need(p.memory.length === 32768 && p.namespaceId?.length === 4 &&
        p.namespaceId.every(v => Number.isInteger(v) && v >= 0 && v <= 0xffffffff),
    'MINT_CONFIGURATION');
    const s = new Simulator(), canonical = programs();
    const entries = new Map();
    for (let slot = 1; slot < 256; slot++) {
        const words = Array.from(p.memory.slice(slot * 4, slot * 4 + 4));
        if (words.every(w => w === 0)) continue;
        const [base, authority, seal] = words, limit = s.parseNSWord1(authority).limit;
        need(seal === s._integrity32(base, authority), 'MINT_PROVISION_DESCRIPTOR');
        entries.set(slot, {base, words: limit + 1, raw: words});
    }
    need(equal(entries.get(1)?.raw.slice(0, 2) || [], [0, 1023]) &&
        equal(entries.get(14)?.raw.slice(0, 2) || [], [0, 1023]), 'MINT_PROVISION_NSTAB');
    const privateSlots = [18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
    need(equal(p.privateSlots, privateSlots) && new Set(p.freeSlots).size === p.freeSlots.length &&
        p.freeSlots.every(slot => Number.isInteger(slot) && slot >= 28 && slot < 256 &&
            !entries.has(slot)), 'MINT_PROVISION_SLOTS');
    need(Number.isInteger(p.allocationStart) && Number.isInteger(p.allocationEnd) &&
        p.allocationStart >= 8192 && p.allocationEnd <= 16384 &&
        p.allocationStart < p.allocationEnd, 'MINT_CAPACITY');
    const ranges = [];
    for (const [slot, entry] of entries) {
        if ([1, 14, 19].includes(slot)) continue;
        // External MMIO descriptors are not ordinary RAM aliases. This profile
        // does not emulate them and cannot dispatch an Abstract/device service.
        if (entry.base >= p.memory.length) continue;
        need(entry.base >= 1024 && entry.base + entry.words <= p.allocationStart,
            'MINT_PROVISION_RANGE');
        need(!ranges.some(r => entry.base < r.end && entry.base + entry.words > r.start),
            'MINT_PROVISION_ALIAS');
        ranges.push({start: entry.base, end: entry.base + entry.words});
    }
    const gt = (slot, rights) => s.createGT(0, slot, rights, 1) >>> 0;
    const binding = (name, slot, rights) => need(p.views[name] === gt(slot, rights), 'MINT_PROVISION_VIEW');
    binding('nstab', 14, {R: 1, W: 1});
    binding('resultL', 18, {L: 1});
    binding('resultRW', 19, {R: 1, W: 1});
    binding('registry', 20, {R: 1});
    binding('proofSnapshot', 21, {R: 1});
    binding('frozenRequest', 22, {R: 1});
    binding('requesterContext', 23, {R: 1});
    const data = [[20, 'registryBase', 4], [21, 'proofSnapshot', 4],
        [22, 'frozenRequest', 40], [23, 'requesterContext', 12],
        [24, null, 4], [25, null, 32], [27, 'payloadSnapshot', 4096]];
    for (const [slot, key, words] of data) {
        need(entries.get(slot)?.words === words &&
            (!key || p[key] === entries.get(slot).base), 'MINT_PROVISION_VIEW');
    }
    const list = entries.get(18), alias = entries.get(19);
    const h = s.parseLumpHeader(p.memory[list?.base]);
    need(list && h.valid && h.typ === 0 && h.cc === 2 && h.cw === 0 &&
        h.lumpSize === list.words && p.resultCell === list.base + list.words - 1 &&
        alias?.base === p.resultCell && alias.words === 1 &&
        p.memory[p.resultCell] === 0 && p.memory[p.resultCell - 1] === p.views.resultL,
    'MINT_PROVISION_RESULT');
    const expectedRows = {
        mint: [gt(9, {E: 1}), gt(9, {E: 1}), 0x06000000, gt(24, {R: 1}),
            gt(25, {R: 1}), gt(26, {R: 1}), gt(15, {E: 1}), gt(9, {X: 1}),
            p.views.nstab, p.views.resultL, p.views.resultRW, p.views.proofSnapshot,
            p.views.frozenRequest, p.views.requesterContext],
        verifier: [gt(15, {E: 1}), p.views.proofSnapshot, p.views.registry],
    };
    for (const [name, program] of [['mint', canonical.mint], ['verifier', canonical.verifier]]) {
        const r = p.roles[name], e = entries.get(name === 'mint' ? 9 : 15);
        need(r && e && r.slot === (name === 'mint' ? 9 : 15) &&
            r.base === e.base && r.words === e.words && equal(r.descriptor, e.raw) &&
            r.enter === gt(r.slot, {E: 1}) && r.execute === gt(r.slot, {X: 1}) &&
            digest(Array.from(p.memory.slice(r.base, r.base + r.words))) === r.hash &&
            equal(Array.from(p.memory.slice(r.base + 1, r.base + 1 + program.words.length)), program.words),
        'MINT_PROVISION_IDENTITY');
        const header = s.parseLumpHeader(p.memory[r.base]);
        need(header.valid && header.typ === 0 && header.cw === program.words.length &&
            header.lumpSize === r.words && header.cc === expectedRows[name].length &&
            header.cw + 1 + header.cc <= r.words &&
            equal(Array.from(p.memory.slice(r.base + r.words - header.cc, r.base + r.words)),
                expectedRows[name]), 'MINT_PROVISION_CLIST');
    }
    need(p.roles.mint.readEntry === canonical.mint.labels.dispatcher &&
        p.roles.mint.commitEntry === canonical.mint.labels.commit, 'MINT_PROVISION_LINK');
    const r = p.registry;
    need(r.recipient === 'ide.Mint' && r.owner === 0 && r.credential === 0x06000000 &&
        r.replaceTargets.length === 0 && r.destroyTargets.length === 0 &&
        r.proof.length === 4 && r.proof.every(v => Number.isInteger(v) && v >= 0 && v <= 0xffffffff) &&
        r.bindCeiling === 0 && r.revision > 0 && Number.isSafeInteger(r.revision) &&
        equal(r.namespaceId, p.namespaceId) && equal(r.createTypes, [1, 2, 3, 4]),
    'MINT_PROVISION_GRANT');
    // Derive confidentiality ranges from admitted descriptors. A caller cannot
    // omit a private range from an initializer-supplied allow-list.
    p.privateRanges = [
        {base: 0, words: 1024, roles: ['mint']},
        ...['mint', 'verifier'].map(name => ({base: p.roles[name].base,
            words: p.roles[name].words, roles: name === 'mint' ? ['mint'] : ['mint', 'verifier']})),
        ...privateSlots.filter(slot => slot !== 19).map(slot => ({
            base: entries.get(slot).base, words: entries.get(slot).words,
            roles: [20, 21, 22, 23].includes(slot) ? ['mint', 'verifier'] : ['mint'],
            scratch: [21, 22, 23, 27].includes(slot),
        })),
    ];
    const threadSlots = [];
    for (const [slot, e] of entries) {
        // A private R payload/snapshot can contain Thread-shaped bytes without
        // being a provisioned activatable Thread object.
        if (slot === 1 || slot === 14 || privateSlots.includes(slot) ||
            e.base >= p.memory.length) continue;
        const header = s.parseLumpHeader(p.memory[e.base]);
        if (header.valid && header.typ === 2) threadSlots.push(slot);
    }
    need(threadSlots.includes(2) && equal(p.threads.map(t => t.slot).sort((a, b) => a - b),
        threadSlots.sort((a, b) => a - b)), 'MINT_PROVISION_THREADS');
    for (const t of p.threads) {
        need(t.base === entries.get(t.slot).base && t.words === entries.get(t.slot).words,
            'MINT_PROVISION_THREADS');
    }
    return canonical;
}
module.exports = {validate};
