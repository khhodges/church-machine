/**
 * AbstractGTManager — lifecycle manager for Abstract Golden Tokens (AGTs).
 *
 * Foundational rules enforced here:
 *   1. No method ever calls readNSEntry() or writeNSEntry(). Abstract GTs have
 *      no NS table presence.
 *   2. AGTs travel only through c-list slots (CRs at runtime; lump c-list area
 *      at rest). They never appear in DRs or cross network boundaries.
 *   3. The internal Map is the sole backing store. GT identity is carried by
 *      the gt_seq field embedded in the AGT word0.
 *   4. GC collects any token not reachable from a c-list scan and not marked
 *      touched by live().
 *
 * See docs/plans/ns-table-integrity.md §AbstractGTManager.
 */

'use strict';

class AbstractGTManager {
    constructor() {
        // Map<gt_seq: number, TokenRecord>
        // TokenRecord = { value: uint32, valid: boolean, touched: boolean }
        this._tokens = new Map();

        // 9-bit sequence counter — matches GT_LAYOUT.gt_seq and wraps at 512.
        this._seqCounter = 0;

        // GT type code for Abstract tokens as packed into word0.
        this.GT_TYPE = 3;

        // Bit-field layout in word0 for an AGT.
        // Abstract type uses canonical GT_LAYOUT bits [26:25]; sequence is [24:16].
        // Remaining fields are zero for this manager's host-backed tokens.
        this._TYPE_SHIFT = 25;
        this._SEQ_SHIFT  = 16;
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    _nextSeq() {
        const seq = this._seqCounter;
        this._seqCounter = (this._seqCounter + 1) & 0x1FF;
        return seq;
    }

    _packWord0(seq) {
        return (((this.GT_TYPE & 0x3) << this._TYPE_SHIFT) |
                ((seq & 0x1FF)        << this._SEQ_SHIFT)) >>> 0;
    }

    _unpackSeq(word0) {
        return (word0 >>> this._SEQ_SHIFT) & 0x1FF;
    }

    _isAGT(word0) {
        return ((word0 >>> this._TYPE_SHIFT) & 0x3) === this.GT_TYPE;
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * createAtoken(value) → AGT word0
     *
     * Stores value in the internal Map and returns an AGT word0 tag.
     * The caller must place this into CR0 — it is immediately in the c-list.
     * Never touches the NS table.
     *
     * @param {number} value  Any 32-bit payload (raw integer or IEEE-754 float bits).
     * @returns {number}      AGT word0 to be placed in CR0.
     */
    createAtoken(value) {
        const seq = this._nextSeq();
        this._tokens.set(seq, {
            value:   (value >>> 0),
            valid:   true,
            touched: false
        });
        return this._packWord0(seq);
    }

    /**
     * get(agtWord0) → stored 32-bit value
     *
     * The AGT argument must arrive via a CR (c-list slot).
     * Faults (returns null) if the token is not valid or not an AGT.
     * Never touches the NS table.
     *
     * @param {number} agtWord0  The AGT word0 from a CR.
     * @returns {number|null}    Stored value, or null on fault.
     */
    get(agtWord0) {
        if (!this._isAGT(agtWord0)) return null;
        const seq = this._unpackSeq(agtWord0);
        const rec = this._tokens.get(seq);
        if (!rec || !rec.valid) return null;
        return rec.value;
    }

    /**
     * release(agtWord0)
     *
     * Normal-path destruction. Sets valid=false.
     * Subsequent get() or live() on this AGT will fault.
     * The caller must clear the CR holding this AGT.
     *
     * @param {number} agtWord0
     */
    release(agtWord0) {
        if (!this._isAGT(agtWord0)) return;
        const seq = this._unpackSeq(agtWord0);
        const rec = this._tokens.get(seq);
        if (rec) rec.valid = false;
    }

    /**
     * live(agtWord0)
     *
     * G-bit equivalent. Asserts to GC that this token is still in active use
     * even if it is not currently visible in a CR scan. GC will not collect a
     * touched token. GC clears all touched flags after each sweep.
     *
     * @param {number} agtWord0
     * @returns {boolean}  true if the token was found and marked; false on fault.
     */
    live(agtWord0) {
        if (!this._isAGT(agtWord0)) return false;
        const seq = this._unpackSeq(agtWord0);
        const rec = this._tokens.get(seq);
        if (!rec || !rec.valid) return false;
        rec.touched = true;
        return true;
    }

    /**
     * GC(sim)
     *
     * Fault-path automatic destruction. Scans all c-lists — CRs of the active
     * thread, saved CR snapshots in the thread table, and the Scheduler.IRQ
     * thread — to find reachable AGTs. Preserves anything marked touched by
     * live(). Releases all unreachable tokens. Clears all touched flags.
     *
     * Never touches the NS table.
     *
     * @param {object} sim  ChurchSimulator instance.
     */
    GC(sim) {
        const reachable = new Set();

        // Helper: scan an array of CR objects for AGT word0 values.
        const scanCRs = (crArray) => {
            if (!crArray) return;
            for (const cr of crArray) {
                if (!cr) continue;
                const w0 = cr.word0 >>> 0;
                if (this._isAGT(w0)) {
                    reachable.add(this._unpackSeq(w0));
                }
            }
        };

        // Scan active thread CRs.
        if (sim.cr) scanCRs(sim.cr);

        // Scan saved thread snapshots in the thread table.
        if (sim.threads) {
            for (const thread of Object.values(sim.threads)) {
                if (thread && thread.cr) scanCRs(thread.cr);
            }
        }

        // Scan Scheduler.IRQ thread (NS slot 50) if it has a saved CR state.
        const IRQ_THREAD_NS = 50;
        if (sim.irqThread && sim.irqThread.cr) {
            scanCRs(sim.irqThread.cr);
        } else if (sim.threads && sim.threads[IRQ_THREAD_NS]) {
            scanCRs(sim.threads[IRQ_THREAD_NS].cr);
        }

        // Scan lump c-list areas for every resident NS entry.
        if (sim.readNSEntry && sim.memory) {
            const maxNS = sim.nsCount || 0;
            for (let slot = 0; slot < maxNS; slot++) {
                const entry = sim.readNSEntry(slot);
                if (!entry || !entry.word0_location) continue;
                const loc  = entry.word0_location;
                const cc   = entry.cc || 0;
                const lumpSz = entry.lump_size || 0;
                if (cc <= 0 || lumpSz <= 0) continue;
                const clistBase = (loc + lumpSz - cc) >>> 0;
                for (let ci = 0; ci < cc; ci++) {
                    const w0 = sim.memory[clistBase + ci] >>> 0;
                    if (this._isAGT(w0)) {
                        reachable.add(this._unpackSeq(w0));
                    }
                }
            }
        }

        // Release unreachable tokens; preserve touched ones; clear all touched flags.
        for (const [seq, rec] of this._tokens) {
            if (!rec.valid) continue;
            if (reachable.has(seq)) {
                rec.touched = false;
                continue;
            }
            if (rec.touched) {
                rec.touched = false;
                continue;
            }
            rec.valid = false;
        }
    }

    /**
     * stats() → { total, valid, touched }
     *
     * Diagnostic summary for the simulator output panel.
     */
    stats() {
        let total = 0, valid = 0, touched = 0;
        for (const rec of this._tokens.values()) {
            total++;
            if (rec.valid)   valid++;
            if (rec.touched) touched++;
        }
        return { total, valid, touched };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AbstractGTManager };
}
