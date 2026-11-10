'use strict';

// Reuse the merged adoption implementation, including ordinary compilation,
// approval, destination localization and publication in its PRIVATE simulator.
// These are review/test inputs, never live Namespace assignments.
const crypto = require('node:crypto');
const {createDemo} = require('./revision_adoption');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function bytes(words) {
    const out = Buffer.alloc(words.length * 4);
    words.forEach((word, i) => out.writeUInt32LE(word >>> 0, i * 4));
    return out;
}
function inputs(oldSize = 64, newSize = 256, {cooperative = false} = {}) {
    const d = createDemo();
    const records = [];
    function install(name, body, options) {
        const candidate = d.compile(body, options);
        const revision = d.publish(d.stage(candidate.words, candidate.ticket));
        const words = Array.from(d.sim.memory.slice(
            revision.base, revision.base + revision.hdr.lumpSize));
        const ns = d.sim._nsSlotBase(revision.slot);
        records.push({
            name, sourceBody: body, slot: revision.slot, gt: revision.gt,
            baseByte: revision.base * 4, sizeWords: words.length,
            portableSha256LE: sha(bytes(candidate.words)),
            localizedSha256LE: sha(bytes(words)),
            words,
            descriptor: Array.from(d.sim.memory.slice(ns, ns + 4)),
            dependencyGT: options?.dependency?.gt ?? null,
        });
        return revision;
    }
    const caller = cooperative
        ? 'again:\nLOAD CR2, CR6, #1\nCALL CR2, #0\nIADD DR10, DR1, #0\nCHANGE CR11\nBRANCH again'
        : 'LOAD CR1, CR6, #1\nCALL CR1, #0\nHALT';
    const old = install('old', 'IADD DR1, DR0, #17\n' +
        (cooperative ? 'CHANGE CR11\nRETURNAL 2048' : 'RETURN'), {size: oldSize});
    install('old-caller', caller, {dependency: old});
    const next = install('new', 'IADD DR1, DR0, #29\n' +
        (cooperative ? 'RETURNAL 2048' : 'RETURN'), {size: newSize});
    install('new-caller', caller, {dependency: next});
    return {
        schema: 'church.combined-input-preflight/v1',
        scope: 'compiler/adoption input preflight; not an application image or RTL acceptance',
        byteOrder: 'little-endian',
        records,
        reservedBytes: d.reservedWords * 4,
        // A frozen, disjoint proposal, not a provisioned staging capability.
        staging: {baseByte: 0xa000, sizeBytes: 1024},
        imageAllowlistChanged: false,
        runtimeCallerSelectionImplemented: false,
    };
}
if (require.main === module) {
    if (process.argv[2] === 'system') {
        const body = require('node:fs').readFileSync(0, 'utf8');
        const d = createDemo();
        const candidate = d.compile(body, {size: 256});
        const bound = d.sim._mintOrdinaryLumpIdentity(candidate.words, 3, 0x8400 / 4,
            {compilerOwnedSelf: true, destinationSequence: 73});
        if (!bound.ok) throw new Error(bound.message);
        console.log(JSON.stringify({words: bound.words, sourceBody: body,
            localizedSha256LE: sha(bytes(bound.words))}));
    } else {
        const shrinking = process.argv[3] === 'shrink';
        console.log(JSON.stringify(inputs(shrinking ? 256 : 64, shrinking ? 64 : 256,
            {cooperative: process.argv[2] === 'cooperative'}), null, 2));
    }
}
module.exports = {inputs, bytes};
