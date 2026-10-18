'use strict';

// Authorized, disposable initialization only. All use after provisioning is
// compiled Church code driven through the sealed facade, never host CR writes.
const Simulator = require('../../simulator/simulator');
const Thread = require('../../simulator/thread_design');
const {compile, digest} = require('../../simulator/mint/protected-programs');
const {fixture} = require('./protected_fixture');

function useFixture(type, source, {threadSource} = {}) {
    const p = fixture({consumer: true}), s = new Simulator();
    const token = rights => s.createGT(0, 16, rights, 1) >>> 0;
    const singleReturn = [2, 3, 4, 7, 8, 9, 10, 11]
        .map(cr => `TPERM CR${cr}, NULL\nBRANCHNE failed`).join('\n');
    const code = compile(`BRANCH entry\nentry:\n${singleReturn}\n${source}\nHALT\nfailed:\nMINT FAIL
${threadSource === undefined ? '' : `thread_entry:\n${threadSource}\nHALT`}`);
    // The consumer is NOT Mint and has no credential or private-view grants.
    // Its independently provisioned B=1 SELF copy is the SAVE source, not a
    // newly minted B=1 result. The approved Mint bind ceiling remains zero.
    const caps = [token({E: 1}), token({E: 1, B: 1}),
        token({L: 1}), token({S: 1}), p.roles.mint.enter];
    assertFits(code.words.length, caps.length);
    const base = 1920, size = 128, enter = caps[0];
    p.memory[base] = s.packLumpHeader(1, code.words.length, caps.length, 0);
    p.memory.set(code.words, base + 1);
    p.memory.set(caps, base + size - caps.length);
    p.memory.set([base, size - 1, s._integrity32(base, size - 1), enter], 16 * 4);
    p.memory[2]++;

    const words = type === 2 ? 256 : 64;
    const payload = Array(words).fill(0);
    if (type === 2) {
        const layout = Thread.layout(words, 32);
        payload[0] = s.packLumpHeader(2, 32, 12, 2);
        payload[layout.stackEnd - 1] = p.roles.mint.enter;
        payload[layout.stackEnd] = s._packFrameWordRaw(0x7fff, 1, layout.stackEnd);
        payload[17] = s._packProtectedIndicator(layout.stackEnd - 2, 1, {}, 0);
        payload[layout.capsStart] = p.roles.mint.enter;
        if (threadSource !== undefined) {
            // Amobea owns Thread initialization but is not implemented yet.
            // This disposable preinitialized fixture is not lifecycle evidence.
            // Program input is supplied BEFORE Mint admission. The consumer's
            // exact E authority is held in CR11 by the compiled Mint caller.
            // CHANGE later consumes this context without host intervention.
            payload[layout.stackEnd - 1] = enter;
            payload[layout.capsStart] = enter;
            payload[layout.stackEnd - 3] = enter;
            payload[layout.stackEnd - 2] = s._packFrameWordRaw(
                code.labels.thread_entry, 1, layout.stackEnd - 2);
            payload[17] = s._packProtectedIndicator(layout.stackEnd - 4, 1, {}, 0);
        }
    } else if (type === 3) {
        payload[0] = s.packLumpHeader(0, 0, 2, 0);
        // A non-NULL, different canary distinguishes a real SAVE from a no-op.
        payload[words - 1] = p.roles.mint.enter;
    } else throw new Error('Use fixture supports only Thread-LS and LS');
    p.memory.set(payload, 1664);
    p.memory.set([1664, words - 1, s._integrity32(1664, words - 1), 0x0200001a], 26 * 4);
    p.memory.set([type, words, words, type], 1607);
    digest(payload).match(/.{8}/g).forEach((w, i) => { p.memory[1622 + i] = parseInt(w, 16); });
    return p;
}

function assertFits(codeWords, caps) {
    if (1 + codeWords + caps > 128) throw new Error('Consumer exceeds its admitted LUMP');
}

module.exports = {useFixture};
