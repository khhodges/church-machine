'use strict';
const {digest} = require('./protected-programs');
const Thread = require('../thread_design');

function requireThat(condition, code = 'MINT_AUTHORITY') {
    if (!condition) { const error = new Error(code); error.code = code; throw error; }
}
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function captureR(s, cr, count) {
    const cap = s.cr[cr], checked = s.mLoad(cap.word0, 'R', cr);
    requireThat(checked.ok, 'MINT_INPUT');
    const e = checked.entry, limit = s.parseNSWord1(e.word1_limit).limit;
    requireThat(Number.isSafeInteger(count) && count > 0 && count <= 4096 &&
        limit + 1 === count && cap.word1 === e.word0_location, 'MINT_INPUT');
    const end = s.mLoad(cap.word0, 'R', cr, e.word0_location + count - 1);
    requireThat(end.ok, 'MINT_INPUT');
    return Array.from(s.memory.slice(e.word0_location, e.word0_location + count));
}
function decodeRequest(s, state) {
    const request = captureR(s, 4, 32), proof = captureR(s, 3, 4);
    requireThat(request[0] === 0x4d4e5431 && request[1] === 32 && request[2] === 1,
        'MINT_REQUEST');
    requireThat(equal(request.slice(8, 12), state.plan.namespaceId), 'MINT_NAMESPACE');
    requireThat(request.slice(27).every(v => v === 0), 'MINT_REQUEST');
    requireThat(request[3] >= 1 && request[3] <= 4 && request[6] === request[3] &&
        request[7] <= state.registry.bindCeiling, 'MINT_RIGHTS');
    requireThat(request.slice(12, 18).every(v => v === 0) && request[26] === 0 &&
        s.cr[7].word0 === 0, 'MINT_TARGET');
    const size = request[5], count = request[4];
    requireThat(Number.isSafeInteger(size) && size >= count && size <= 4096 &&
        size > 0 && (size & (size - 1)) === 0 && count > 0, 'MINT_SIZE');
    const payload = captureR(s, 8, count);
    const hash = digest(payload);
    requireThat(hash === request.slice(18, 26).map(v => v.toString(16).padStart(8, '0')).join(''),
        'MINT_PAYLOAD');
    validatePayload(s, request[3], payload, size);
    return {request, proof, payload, size, type: request[3], bind: request[7]};
}
function validatePayload(s, type, payload, size) {
    if (type === 4) return;
    const h = s.parseLumpHeader(payload[0]);
    requireThat(h.valid && h.lumpSize === size && payload.length === size, 'MINT_PAYLOAD');
    if (type === 2) {
        const layout = Thread.layout(size, h.cw);
        requireThat(h.typ === 2 && h.cc === 12 && layout.valid, 'MINT_THREAD');
        // New dormant Threads must have a genuine poison-root frame, not an
        // arbitrary resume PC or a fabricated running context.
        const indicator = s._unpackProtectedIndicator(payload[17]);
        const frame = s._unpackFrameWord(payload[layout.stackEnd]);
        const enter = payload[layout.stackEnd - 1];
        requireThat(indicator.sz === 1 && indicator.sto === layout.stackEnd - 2 &&
            frame.returnPC === 0x7fff && frame.savedSTO === layout.stackEnd &&
            frame.sz === 1 && s.mLoad(enter, 'E', 14).ok, 'MINT_THREAD');
        for (let i = 0; i < 12; i++) validateToken(s, payload[layout.capsStart + i]);
    } else {
        requireThat(h.typ === 0 && h.cc >= 1 && 1 + h.cw + h.cc <= size, 'MINT_PAYLOAD');
        requireThat(type !== 1 || h.cw > 0, 'MINT_PAYLOAD');
        // Slot is selected by Mint, not the requester. The one unresolved SELF
        // row must be NULL and is bound to this allocation's exact result GT.
        requireThat(payload[size - h.cc] === 0, 'MINT_PAYLOAD_SELF');
        for (const token of payload.slice(size - h.cc + 1)) validateToken(s, token);
        if (type === 1) {
            // Every branch target is bounded, including the dispatch prefix.
            for (let pc = 0; pc < h.cw; pc++) {
                const d = s.decodeInstruction(payload[1 + pc]);
                requireThat(![8, 9, 10, 11, 12, 13, 14, 15, 26, 27, 28, 29, 31].includes(d.opcode),
                    'MINT_CODE');
                if (d.opcode === 23) {
                    const offset = d.imm & 0x4000 ? d.imm | 0xffff8000 : d.imm;
                    requireThat(pc + offset >= 0 && pc + offset < h.cw, 'MINT_CODE');
                }
            }
        }
    }
}
function validateToken(s, token) {
    if (token === 0) return;
    const p = s.parseGT(token);
    requireThat(p.type === 1 && !p.malformed && !p.permissions.B &&
        s.mLoad(token, null).ok, 'MINT_PAYLOAD_CAPABILITY');
    // Valid descriptor bits are not authority to initialize arbitrary existing
    // capabilities. Require a real held input, and never copy internal views,
    // verifier E, Namespace or Thread context into a newly issued object.
    requireThat(![1, 2, 11, 12, 14, 15, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27].includes(p.index) &&
        s.cr.some(cap => cap.word0 === token), 'MINT_PAYLOAD_CAPABILITY');
}
function role(s, state, name) {
    const r = state.plan.roles[name], slot = s.parseGT(s.cr[14].word0).index;
    requireThat(slot === r.slot, 'MINT_IDENTITY');
    const e = s.readNSEntry(slot);
    requireThat(e && equal(Array.from(s.memory.slice(slot * 4, slot * 4 + 4)), r.descriptor) &&
        digest(Array.from(s.memory.slice(e.word0_location, e.word0_location + r.words))) === r.hash,
    'MINT_IDENTITY');
    return r;
}
function context(s, state, name = 'mint') {
    role(s, state, name);
    const c = state.context;
    requireThat(c && !state.poisoned && c.thread === s.cr[12].word0 &&
        c.threadBase === s.cr[12].word1 && equal(c.root, Object.values(s.cr[15]).slice(0, 4)) &&
        c.registryRevision === state.registry.revision, 'MINT_CONTEXT');
    return c;
}
function verifyGrant(s, state) {
    const c = context(s, state, 'verifier'), r = state.registry;
    requireThat(r.issued === true && r.revoked === false && r.owner === 0 &&
        r.credential === 0x06000000 && c.credential === r.credential &&
        r.recipient === 'ide.Mint' && c.caller === state.plan.roles.mint.enter &&
        r.replaceTargets.length === 0 && r.destroyTargets.length === 0 &&
        r.createTypes.includes(c.type) && equal(r.namespaceId, state.plan.namespaceId),
    'MINT_CREDENTIAL');
    return c;
}

function liveDependencies(s, state) {
    const live = new Set([s.cr[12].word0 & 65535, s.cr[14].word0 & 65535,
        s.cr[6].word0 & 65535, 1]);
    for (const thread of state.plan.threads) {
        const layout = s._threadLayoutAtBase(thread.base);
        requireThat(layout && layout.lumpSize === thread.words, 'MINT_LIVE_CONTEXT');
        let {sto, sz} = s._unpackProtectedIndicator(s.memory[thread.base + 17]);
        let foundRoot = false;
        for (let count = 0; count < layout.stackWords; count++) {
            const address = sto + (sz ? 2 : 1);
            requireThat(address > layout.stackStart && address <= layout.stackEnd,
                'MINT_LIVE_CONTEXT');
            const frame = s._unpackFrameWord(s.memory[thread.base + address]);
            requireThat(frame.savedSTO === address, 'MINT_LIVE_CONTEXT');
            if (sz) {
                const token = s.memory[thread.base + address - 1];
                const check = s.mLoad(token, 'E', 14);
                requireThat(check.ok, 'MINT_LIVE_CONTEXT');
                const h = s.parseLumpHeader(s.memory[check.entry.word0_location]);
                requireThat(h.valid && h.typ === 0 &&
                    (frame.returnPC === 0x7fff || frame.returnPC < h.cw), 'MINT_LIVE_CONTEXT');
                live.add(token & 65535);
            } else {
                // An SZ=0 frame has same-artifact authority only in the
                // currently admitted, protected Lambda continuation.
                requireThat(state.continuation && thread.base === s.cr[12].word1 &&
                    state.continuation.frameAddress === address, 'MINT_LIVE_CONTEXT');
            }
            if (frame.returnPC === 0x7fff) {
                requireThat(sz === 1 && frame.sz === 1 && address === layout.stackEnd,
                    'MINT_LIVE_CONTEXT');
                foundRoot = true;
                break;
            }
            sto = address;
            sz = frame.sz;
        }
        requireThat(foundRoot, 'MINT_LIVE_CONTEXT');
        live.add(thread.slot);
    }
    return live;
}

module.exports = {requireThat, equal, captureR, decodeRequest, validatePayload,
    role, context, verifyGrant, liveDependencies};
