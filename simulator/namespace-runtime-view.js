'use strict';

// Architectural reads only: no names, catalog selection, slot caches, lazy
// resolution, mutation, or fallback to the saved/inspected Namespace.
(function(root) {
    class NamespaceGeometryError extends Error {
        constructor(message) {
            super(message);
            this.name = 'NamespaceGeometryError';
            this.fault = 'BOUNDS';
        }
    }
    const fail = message => { throw new NamespaceGeometryError(message); };
    function geometry(memory, cr15) {
        if (!memory || !cr15) fail('Active Namespace memory or CR15 is unavailable');
        if (((cr15.word0 >>> 25) & 3) !== 1) fail('CR15 must hold an Inform Namespace GT');
        const base = cr15.word1;
        if (!Number.isInteger(base) || base < 0 || base + 4 > memory.length) {
            fail('CR15 Namespace base is outside memory');
        }
        const authority = cr15.word2 >>> 0;
        if (authority >>> 31) fail('Active Namespace cannot be FAR');
        const header = memory[base] >>> 0;
        const exponent = (header >>> 23) & 15;
        const count = (header >>> 10) & 8191;
        if (header >>> 27 !== 31 || ((header >>> 8) & 3) !== 1 ||
                (header & 255) !== 0 || exponent > 9 || count < 3) {
            fail('Active Namespace has an invalid metadata header');
        }
        const capacity = 2 ** (exponent + 13);
        const tableWords = count * 4;
        if ((authority & 0x1fffff) !== tableWords - 1) {
            fail('CR15 limit must equal four times Namespace slot count minus one');
        }
        if (tableWords > capacity || base + capacity > memory.length) {
            fail('Active Namespace allocation or table exceeds memory');
        }
        if ((memory[base + 1] >>> 0) !== base) fail('Namespace metadata base disagrees with CR15');
        if ((memory[base + 2] >>> 0) > count - 2) fail('Namespace member count exceeds table capacity');
        if ((memory[base + 3] >>> 0) !== 0) fail('Namespace reserved metadata word must be zero');
        return {base, count, tableWords, capacity, bodyStart: base + tableWords,
            end: base + capacity};
    }

    function slotAddress(memory, cr15, index) {
        const ns = geometry(memory, cr15);
        if (!Number.isInteger(index) || index < 1 || index >= ns.count) {
            fail('Namespace capability slot is outside the active table (slot 0 is metadata)');
        }
        return ns.base + index * 4;
    }

    function readEntry(memory, cr15, index) {
        const ns = geometry(memory, cr15);
        if (!Number.isInteger(index) || index < 1 || index >= ns.count) return null;
        const address = ns.base + index * 4;
        const [w0, w1, w2, w3] = Array.from(memory.slice(address, address + 4), w => w >>> 0);
        if (!(w0 || w1 || w2 || w3)) return null;
        let clistCount = 0;
        // Metadata is never obtained from another Namespace's resident body.
        // External/device descriptors retain their raw authority for subsequent
        // type-specific validation; they do not acquire a host-side c-list.
        if (w0 >= ns.bodyStart && w0 < ns.end) {
            const header = memory[w0] >>> 0;
            const type = (header >>> 8) & 3;
            const size = 2 ** (((header >>> 23) & 15) + 6);
            const cw = (header >>> 10) & 8191;
            const cc = header & 255;
            if (header >>> 27 === 31 && (type === 0 || type === 2) &&
                    w0 + size <= ns.end && 1 + cw + cc <= size) {
                clistCount = cc;
            }
        }
        return {word0_location: w0, word1_limit: w1, word2_seals: w2,
            word3_cache_token: w3, word3_abstract_gt: w3,
            gBit: (w1 >>> 30) & 1, gtSeq: (w1 >>> 21) & 511,
            gtType: 1, clistCount, chainable: false, label: ''};
    }
    const api = {geometry, slotAddress, readEntry, NamespaceGeometryError};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ChurchNamespaceRuntimeView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
