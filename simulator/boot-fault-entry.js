'use strict';

// Functional local-memory model of the approved Boot fault-entry contract.
// No image selection, Namespace mutation, hardware transport, retries, or
// application restart policy. Physical port timing remains an RTL obligation.
(function(root) {
    class BootFaultEntry {
        constructor(sim, {root: bootRoot, threadGT, handlerGT, imageIdentity}) {
            if (sim._liveThreadOwned || sim.stepCount || !imageIdentity)
                throw Error('Configure fault entry on a fresh image, before execution');
            this.sim = sim;
            this.root = Object.freeze({...bootRoot, m: 0});
            this.threadGT = threadGT >>> 0;
            this.handlerGT = handlerGT >>> 0;
            this.imageIdentity = String(imageIdentity);
            this.withRoot(() => {
                const ns = sim.namespaceGeometry();
                const t = sim.parseGT(this.threadGT);
                if (t.index !== 2 || t.type !== 1 || Object.values(t.permissions).some(Boolean))
                    throw Error('Boot fault target must be permissionless Thread slot 2');
                const thread = this.checked(this.threadGT);
                const handler = this.checked(this.handlerGT, 'E');
                const hp = sim.parseGT(this.handlerGT);
                if (Object.entries(hp.permissions).some(([p,v]) => p !== 'E' && v))
                    throw Error('Fault handler requires an E-only GT');
                this.base = thread.entry.word0_location;
                this.layout = sim._threadLayoutAtBase(this.base);
                if (!this.layout || !this.layout.valid) throw Error('Invalid Boot.Thread geometry');
                this.handlerBase = handler.entry.word0_location;
                const header = sim.parseLumpHeader(sim.memory[this.handlerBase]);
                if (!header.valid || header.typ !== 0 || !header.cw || !header.cc)
                    throw Error('Fault handler must be resident executable code');
                if (this.overlaps(this.handlerBase, header.lumpSize))
                    throw Error('Fault handler overlaps Boot.Thread');
                // Exact immutable admission inputs, not a fault-event bank.
                this.pinned = [];
                const pin = (base, count, descriptors = false) => {
                    for (let i = 0; i < count; i++)
                        this.pinned.push(Object.freeze([base + i, sim.memory[base + i] >>> 0,
                            descriptors && i % 4 === 1 ? (~0x40000000 >>> 0) : 0xffffffff]));
                };
                pin(ns.base, 2);
                pin(ns.base + 4, 8, true); // G is a validation cache, not identity
                pin(ns.base + hp.index * 4, 4, true);
                pin(this.base, 1);
                pin(this.handlerBase, header.lumpSize);
                Object.freeze(this.pinned);
            });
            Object.freeze(this);
        }
        overlaps(base, size) {
            return base < this.base + this.layout.lumpSize && base + size > this.base;
        }
        withRoot(fn) {
            const old = this.sim.cr[15];
            this.sim.cr[15] = {...this.root};
            try { return fn(); } finally { this.sim.cr[15] = old; }
        }
        checked(gt, permission = null, register = 12) {
            const check = this.sim.mLoad(gt, permission, register);
            if (!check.ok) throw Object.assign(Error(check.message), {fault: check.fault});
            return check;
        }
        enter(event) {
            const s = this.sim;
            s._faultEntryBusy = true;
            const status = s.bootFaultStatus = {
                state: 'stashing', imageIdentity: this.imageIdentity,
                saveAttempts: 0, eventCode: event.faultCode, writes: [],
            };
            const write = (address, value) => {
                s._writeRuntimeWord(address, value);
            };
            // All fault-path writes (including the shared outgoing saver and
            // incoming activation) get one completion/readback check.
            const originalWrite = s._writeRuntimeWord;
            s._writeRuntimeWord = function(address, value) {
                const result = originalWrite.call(this, address, value);
                if ((this.memory[address] >>> 0) !== (value >>> 0))
                    throw Error(`Fault-entry write/readback mismatch at word ${address}`);
                status.writes.push(address);
                return result;
            };
            try {
                for (const [address, value, mask] of this.pinned)
                    if ((s.memory[address] & mask) !== (value & mask))
                        throw Error('Configured Boot image binding changed; prepare a new image');
                const originalBase = s.cr[12].word1;
                const originalLimit = s.parseNSWord1(s.cr[12].word2).limit;
                if (!s._liveThreadOwned || this.overlaps(originalBase, originalLimit + 1))
                    throw Error('Faulting Thread overlaps Boot stash or is not active');
                if (!Number.isInteger(event.faultCode))
                    throw Error('Fault has no approved numeric machine code');
                const b = this.base, l = this.layout;
                // First event stores go directly to Boot, while live CR12/15
                // and all outgoing homes remain untouched.
                write(b + l.capsStart + 1, s.cr[12].word0);
                write(b + l.capsStart + 2, s.cr[15].word0);
                write(b + 2, event.faultCode);
                write(b + 3, (event.physicalPC >>> 0) * 4);
                write(b + 4, 0);
                write(b + 5, event.faultRawWord == null
                    ? s.memory[event.physicalPC] >>> 0 : event.faultRawWord);
                write(b + 6, 0);
                write(b + 1, 0);
                for (let i = 6; i < 16; i++) write(b + 1 + i, 0);
                for (let i = 0; i < 12; i++)
                    if (i !== 1 && i !== 2) write(b + l.capsStart + i, i === 0 ? this.handlerGT : 0);
                // Canonical poison root; never a continuation into denied code.
                s._formatThreadRootSentinel(b, l, this.handlerGT);
                status.state = 'saving';
                status.saveAttempts = 1;
                let saveError = null;
                try {
                    if (!s._suspendLiveThread(s.parseGT(s.cr[12].word0).index, null, event.pc))
                        throw Error('Outgoing context save did not complete');
                } catch (error) { saveError = error; }
                status.state = 'finalizing';
                write(b + 4, saveError ? 2 : 1);
                // Do not invent a hardware error number for host-memory errors.
                // Known architectural secondary errors retain their real code.
                const code = saveError && s.constructor.FAULT_CODES[saveError.fault];
                if (saveError && !Number.isInteger(code))
                    throw Error('Outgoing save failed without an approved secondary code: ' + saveError.message);
                write(b + 6, Number.isInteger(code) ? code : 0);
                if (saveError) status.saveFailure = saveError.message;
                // Validate under the original root BEFORE replacing CR15.
                s.namespaceGeometry();
                const parsed = s.parseGT(s.cr[12].word0);
                if (parsed.type !== 1 || Object.values(parsed.permissions).some(Boolean))
                    throw Error('Original Thread authority is invalid');
                const original = this.checked(s.cr[12].word0);
                if ((original.entry.word0_location >>> 0) !== (s.cr[12].word1 >>> 0) ||
                    ((original.entry.word1_limit & ~0x40000000) >>> 0) !==
                        ((s.cr[12].word2 & ~0x40000000) >>> 0))
                    throw Error('Original Thread cached authority differs from its Namespace');
                const activation = {references: {
                    1: {...s.cr[12]}, 2: {...s.cr[15]},
                }};
                // Post-stash incoming staging; no generic Boot-root lookup of
                // the foreign pair, no new permissions or version refresh.
                s._faultEntryActivation = activation;
                status.state = 'activating';
                s.cr[15] = {...this.root};
                const result = s._activateChangeThread(this.threadGT, {crDst: 12},
                    0, true, activation);
                if (!result) throw Error('Boot activation failed');
                s.bootComplete = true;
                s.halted = false;
                status.state = 'entered';
                event.bootFaultEntry = {state: 'entered', saveStatus: saveError ? 2 : 1};
                s.output += '[fault-entry] Entered configured Boot handler at word offset 0.\n';
                return {faultEntry: true, pc: 0, physicalPC: s.cr[14].word1 + 1,
                    pipeline: [], desc: 'HardFault → Boot.Thread', event,
                    executionEvidence: s.lastStepEvidence};
            } catch (error) {
                status.state = 'catastrophic';
                status.reason = error.message;
                status.led = {activeLow: true, index: 1, toggleMilliseconds: 1000};
                s.halted = true;
                s.running = false;
                event.bootFaultEntry = {state: 'catastrophic', reason: error.message};
                s.output += `[fault-entry] CATASTROPHIC LED LOOP: ${error.message}\n`;
                return null;
            } finally {
                s._writeRuntimeWord = originalWrite;
                s._faultEntryActivation = null;
                s._faultEntryBusy = false;
            }
        }
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = BootFaultEntry;
    else root.ChurchBootFaultEntry = BootFaultEntry;
})(typeof globalThis !== 'undefined' ? globalThis : this);
