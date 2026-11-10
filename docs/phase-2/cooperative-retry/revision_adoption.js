'use strict';

// Bounded local demonstration, NOT a network admission service or RTL loader.
// Authority is a host-owned exact compiler-output ticket; raw bytes cannot
// authorize themselves. All writes are to a private simulator instance.
const crypto = require('node:crypto');
const {fixture, Sim} = require('../../../tests/simulator/cr6_contract_fixture');
const Compiler = require('../../../simulator/cloomc_compiler');
const Builder = require('../../../simulator/lump_builder');

function hash(words) {
    const bytes = Buffer.alloc(words.length * 4);
    words.forEach((word, i) => bytes.writeUInt32BE(word >>> 0, i * 4));
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

function createDemo({capacity = 2048} = {}) {
    const {sim, activate} = fixture(true);
    const start = 0x2400;
    if (!Number.isInteger(capacity) || capacity < 0 || start + capacity > sim.NS_TABLE_BASE)
        throw new Error('invalid arena bounds');
    let used = 0, nextSlot = 40;
    const tickets = new WeakMap(), staged = new WeakMap(), published = new WeakSet();
    const events = [];

    function compile(body, {size = 64, dependency = null} = {}) {
        if (!Number.isSafeInteger(size) || size < 64 || size > 1024 ||
            (size & (size - 1)) !== 0) throw new Error('invalid allocation bounds');
        if (dependency && !published.has(dependency)) throw new Error('unauthorized dependency');
        if (dependency && !sim.mLoad(dependency.gt, 'E', 1).ok)
            throw new Error('stale dependency authority');
        const source = `abstraction demo.Revision {
            capabilities {
                SELF E
                ${dependency ? 'demo.Revision E' : ''}
            }
            method Run() { ${body} }
        }`;
        const result = new Compiler().compile(source, []);
        if (result.errors.length) throw new Error(JSON.stringify(result.errors));
        const built = Builder.buildLump(result, {allocationWords: size});
        if (built.lumpSize > 1024) throw new Error('unsupported LUMP size');
        built.words[built.clistStart] = Sim.SELF_CAPABILITY_PLACEHOLDER;
        if (dependency) built.words[built.clistStart + 1] = dependency.gt;
        const words = Object.freeze(built.words.slice());
        const ticket = Object.freeze({});
        tickets.set(ticket, {digest: hash(words), dependency, state: 'approved'});
        return {words, ticket};
    }

    function stage(words, ticket) {
        const authority = tickets.get(ticket);
        if (!authority || authority.state !== 'approved') throw new Error('stale or unauthorized approval');
        const copy = Array.from(words);
        if (copy.some(w => !Number.isInteger(w) || w < 0 || w > 0xffffffff) ||
            hash(copy) !== authority.digest) throw new Error('failed exact-byte validation');
        const hdr = sim.parseLumpHeader(copy[0]);
        if (!hdr.valid || hdr.typ !== 0 || hdr.lumpSize !== copy.length ||
            hdr.cc < 1 || 1 + hdr.cw > hdr.lumpSize - hdr.cc ||
            !sim.mintStep7Freespace(copy, hdr).ok) throw new Error('invalid LUMP bounds');
        if (used + copy.length > capacity) throw new Error('insufficient memory');
        if (nextSlot >= 60) throw new Error('insufficient reserved slots');
        const base = start + used, slot = nextSlot;
        if (!sim.memory.slice(base, base + copy.length).every(w => w === 0) ||
            Array.from(sim.memory.slice(sim._nsSlotBase(slot), sim._nsSlotBase(slot) + 4)).some(Boolean))
            throw new Error('allocation is occupied');
        const binding = sim._mintOrdinaryLumpIdentity(copy, slot, base, {compilerOwnedSelf: true});
        if (!binding.ok) throw new Error(binding.message);
        used += copy.length;
        nextSlot++;
        authority.state = 'staged';
        const handle = Object.freeze({});
        staged.set(handle, {binding, base, slot, hdr, authority});
        events.push({event: 'validated', slot, base, words: copy.length, hash: authority.digest});
        return handle;
    }

    function publish(handle) {
        const item = staged.get(handle);
        if (!item || item.authority.state !== 'staged') throw new Error('stale staging handle');
        const {binding, base, slot, hdr, authority} = item;
        if (authority.dependency && !sim.mLoad(authority.dependency.gt, 'E', 1).ok)
            throw new Error('stale dependency authority');
        // Recheck immediately before commit. Publication is synchronous in this
        // local model; no claim is made about RTL memory-port arbitration.
        if (!sim.memory.slice(base, base + hdr.lumpSize).every(w => w === 0) ||
            Array.from(sim.memory.slice(sim._nsSlotBase(slot), sim._nsSlotBase(slot) + 4)).some(Boolean))
            throw new Error('allocation is occupied');
        sim.memory.set(binding.words, base);
        sim.withNamespaceWrite('isolated revision demonstration', () =>
            sim.writeNSEntry(slot, base, hdr.lumpSize - 1, 0, 0, 1,
                binding.entry.seq, hdr.cc, binding.entry.cacheToken));
        authority.state = 'published';
        const revision = Object.freeze({slot, base, hdr, gt: binding.selfGT,
            clistBase: base + hdr.lumpSize - hdr.cc, hash: authority.digest});
        published.add(revision);
        events.push({event: 'published', slot, gt: revision.gt});
        return revision;
    }

    function cancel(handle) {
        const item = staged.get(handle);
        if (!item || item.authority.state !== 'staged') throw new Error('stale staging handle');
        item.authority.state = 'cancelled';
        // Deliberately retain reservations: no reclamation/GC in this demo.
    }
    function install(body, options) {
        const candidate = compile(body, options);
        return publish(stage(candidate.words, candidate.ticket));
    }
    return {sim, activate, compile, stage, publish, cancel, install, events,
        get reservedWords() { return used; }};
}

module.exports = {createDemo, hash};
