'use strict';
(function(root) {

// Explicit new-format core for private image replay. The historical IDE image
// loader is not silently converted by constructing this core. Admission and
// activation remain separate from this in-memory execution interface.
const Simulator = typeof ChurchSimulator !== 'undefined' ? ChurchSimulator : require('./simulator');
const view = typeof ChurchNamespaceRuntimeView !== 'undefined'
    ? ChurchNamespaceRuntimeView : require('./namespace-runtime-view');

class NamespaceRuntimeCore extends Simulator {
    constructor(memory, cr15) {
        super();
        view.geometry(memory, cr15);
        this.memory = new Uint32Array(memory);
        this.cr = Array.from({length: 16}, () => this.emptyCapability());
        this.cr[15] = {...cr15};
        this.dr.fill(0);
        this._namespaceRuntimeReady = true;
        // These properties are legacy instruction-engine interfaces for counts
        // and the upper RAM bound. They are computed, never changed by SWITCH.
        Object.defineProperties(this, {
            nsCount: {get: () => this.namespaceGeometry().count, set: value => {
                // Legacy isolated-LOAD rollback may restore this same count.
                // It cannot alter the architectural header.
                if (value !== this.namespaceGeometry().count) {
                    throw new Error('Namespace slot count is defined by its header');
                }
            }},
            MAX_NS_ENTRIES: {get: () => this.namespaceGeometry().count},
            NS_TABLE_BASE: {get: () => this.namespaceGeometry().end},
        });
        // A new execution core must not inherit host services or slot metadata
        // from the legacy constructor's reset image.
        this.nsLabels = Object.freeze({});
        this.nsHandlers = Object.freeze({});
        this.nsChainable = Object.freeze({});
        this.abstractionRegistry = null;
        this.lazyManifest = Object.freeze({});
        this._bankPrivateSlots = Object.freeze({});
        this._bankPrivateRanges = Object.freeze([]);
        this._slotIdentity = new Map();
        this._tokenSlotMap = new Map();
        this._compilerOwnedSelfSlots = Object.freeze({});
        this._nsSymbolicEntries = Object.freeze({});
        this._nsClistCount = Object.freeze({});
        this._nsUiTypeHint = Object.freeze({});
        for (const field of ['nsLabels', 'nsHandlers', 'nsChainable']) {
            const empty = Object.freeze({});
            Object.defineProperty(this, field, {get: () => empty, set: value => {
                if (!value || Object.keys(value).length) {
                    throw new Error(`${field} belongs to inspection, not Namespace execution`);
                }
            }});
        }
        Object.defineProperty(this, 'abstractionRegistry', {value: null, writable: false});
        this._liveThreadOwned = false;
        this._currentThreadSlot = null;
        Object.defineProperty(this, '_currentThreadSlot', {
            get: () => this._liveThreadOwned && !Simulator.isNullGT(this.cr[12].word0)
                ? this.parseGT(this.cr[12].word0).index : null,
            set: value => {
                if (value !== null && value !== this.parseGT(this.cr[12].word0).index &&
                        !(this._bootRoot && !this.bootComplete && !this._liveThreadOwned &&
                            value === this._bootThreadSlot())) {
                    throw new Error('Active Thread identity is defined by CR12');
                }
            },
        });
        this.bootComplete = true;
        this.mElevation = false;
        this.halted = false;
        this.running = false;
        this.pc = 0;
        this.callStack = [];
        this.faultLog = [];
    }

    emptyCapability() {
        return {word0: 0, word1: 0, word2: 0, word3: 0, m: 0};
    }
    _bootNamespaceSlot() { return 1; }
    _bootThreadSlot() { return 2; }
    _namespaceRoot() {
        // Only the reset/LOAD boundary may inspect the admitted root before
        // CR15 exists. Runtime authority never falls back to another Namespace.
        return this._bootRoot && !this.bootComplete && this.bootStep === 0 &&
            Simulator.isNullGT(this.cr[15].word0) ? this._bootRoot : this.cr[15];
    }
    namespaceGeometry() { return view.geometry(this.memory, this._namespaceRoot()); }
    _liveNamespaceTableGeometry() {
        const ns = this.namespaceGeometry();
        return {
            base: ns.base, start: ns.base, end: ns.bodyStart,
            tableWords: ns.tableWords,
            description: 'Ascending Namespace table (slot 0 metadata)',
            direction: 'ascending',
        };
    }
    _validateLiveLumpContext(context) {
        try {
            return super._validateLiveLumpContext(context);
        } catch (error) {
            if (!(error instanceof view.NamespaceGeometryError)) throw error;
            // Invalid active metadata prevents every descriptor lookup. Keep
            // the real diagnostic visible instead of letting updateGateLog's
            // render catch drop all cards. This does not raise/clear a machine
            // fault or alter the runtime's fail-closed geometry checks.
            return {
                key: context.key, title: context.title,
                register: `CR${context.register}`, expected: context.expected,
                state: 'fault', status: 'fault', result: 'fault',
                slot: null, name: null, reason: error.message,
                checks: [{id: 'header', label: 'NS HEADER', pass: false,
                    state: 'fault', detail: error.message}],
            };
        }
    }
    beginBoot({clearNonBootThreads = false} = {}) {
        if(this._liveThreadOwned || this.halted) throw Error('Boot requires a fresh Namespace image');
        if (clearNonBootThreads) {
            // IDE boot is a fresh execution, not a replay of authored actor
            // starting contexts. Keep allocations/descriptors, discard homes,
            // stack frames, capabilities and heap data for every other Thread.
            // Validate all ranges before changing any bytes.
            const ranges = this.configuredThreadSlots()
                .filter(slot => slot !== this._bootThreadSlot())
                .map(slot => {
                    const base = this.readNSEntry(slot).word0_location;
                    const layout = this._threadLayoutAtBase(base);
                    if (!layout || !layout.valid)
                        throw Error(`Cannot clear invalid Thread allocation NS[${slot}]`);
                    return [base + 1, base + layout.lumpSize];
                });
            for (const [start, end] of ranges) this.memory.fill(0, start, end);
            this._captureThreadBaselines();
        }
        this._bootRoot = Object.freeze({...this.cr[15]});
        this.bootComplete = false;
        this.bootStep = 0;
        this.bootAttemptId++;
        this.bootProgress = this._newBootProgress(this.bootAttemptId);
        const load=this.bootProgress[0], change=this.bootProgress[1];
        load.instruction='LOAD CR15, CR15[1]';
        load.word=this.encodeInstruction(0,14,15,15,16);
        change.instruction='CHANGE CR12, CR15[2]';
        change.word=this.encodeInstruction(4,14,12,15,2);
        this.cr=Array.from({length:16},()=>this.emptyCapability());
        this.output='';
        this.pc=0;
        this.physicalPC=0;
    }
    _threadLifecycleStatus(active, savedIndicator) {
        if (!active && savedIndicator && savedIndicator.sz === 0) return 'uninitialized';
        return super._threadLifecycleStatus(active, savedIndicator);
    }
    _mmioDeviceSlot(index) {
        if (!this._namespaceRuntimeReady) return super._mmioDeviceSlot(index);
        // Device routing follows the verified descriptor's hardware address,
        // not historical Namespace slot numbers (UART is slot 8 in Phase 1).
        // mLoad has already enforced the actual GT's rights/sequence/bounds.
        const contracts = typeof ChurchArchitectureContracts !== 'undefined'
            ? ChurchArchitectureContracts : require('./architecture_contracts');
        const entry = this.readNSEntry(index);
        if (!entry) return -1;
        const limit = this.parseNSWord1(entry.word1_limit).limit;
        for (const [name, device] of Object.entries(contracts.boot.devices)) {
            if (entry.word0_location === device.address && limit < device.words) {
                return contracts.boot.minimalSlots[name];
            }
        }
        return -1; // RAM/unknown devices must not inherit a legacy slot alias.
    }
    startEntryThread() {
        if (this._liveThreadOwned || this.halted) {
            throw new Error('Entry activation requires a fresh, non-faulted Namespace runtime');
        }
        return this._activateChangeThread(0x02000002, {crDst: 12}, 0, true);
    }
    _nsSlotBase(index) {
        return this._namespaceRuntimeReady
            ? view.slotAddress(this.memory, this._namespaceRoot(), index)
            : super._nsSlotBase(index);
    }
    readNSEntry(index) {
        return this._namespaceRuntimeReady
            ? view.readEntry(this.memory, this._namespaceRoot(), index)
            : super.readNSEntry(index);
    }
    isNSEntryValid(index) {
        return this._namespaceRuntimeReady
            ? this.readNSEntry(index) !== null : super.isNSEntryValid(index);
    }
    symbolicEntryAt(index) {
        return this._namespaceRuntimeReady ? null : super.symbolicEntryAt(index);
    }
    mLoad(...args) {
        const result = super.mLoad(...args);
        if (!this._namespaceRuntimeReady || !result.ok) return result;
        const ns = this.namespaceGeometry();
        const base = result.entry.word0_location;
        const limit = this.parseNSWord1(result.entry.word1_limit).limit;
        if (base < this.memory.length) {
            const header = this.parseLumpHeader(this.memory[base]);
            let error = null;
            if (args[1] === 'E' && (!header.valid || header.typ !== 0)) {
                error = 'Executable authority requires an ordinary code LUMP';
            } else if (header.valid && header.typ === 1) {
                try {
                    view.geometry(this.memory, {word0: args[0], word1: base,
                        word2: result.entry.word1_limit});
                } catch (e) {
                    if (!(e instanceof view.NamespaceGeometryError)) throw e;
                    error = e.message;
                }
            } else if (base < ns.bodyStart || base + limit >= ns.end) {
                error = 'Ordinary capability lies outside the active Namespace body';
            }
            if (error) {
                const audit = this.auditLog[this.auditLog.length - 1];
                if (audit) {
                    audit.result = 'fail';
                    audit.checks.namespaceRange = {pass: false, message: error};
                }
                return {ok: false, fault: 'BOUNDS', message: error};
            }
        } else if (this._mmioDeviceSlot(result.index) === -1 || args[1] === 'E') {
            return {ok: false, fault: 'BOUNDS',
                message: 'External descriptor is not a supported simulated device with bounded data authority'};
        }
        return result;
    }
    _dispatchLoaderLoad() {
        this.fault('CODE_NOT_RESIDENT', 'Namespace execution requires explicitly installed resident bytes');
        return null;
    }
    _dispatchAbstractCall() {
        this.fault('CODE_NOT_RESIDENT', 'Unresolved authority cannot dispatch through a host catalog');
        return null;
    }
    _threadLayoutAtBase(base) {
        if (this._namespaceRuntimeReady) {
            const ns = this.namespaceGeometry();
            if (base < ns.bodyStart || base >= ns.end) return null;
            const header = this.parseLumpHeader(this.memory[base]);
            if (!header.valid || base + header.lumpSize > ns.end) return null;
        }
        return super._threadLayoutAtBase(base);
    }
    step() {
        try { return super.step(); }
        catch (error) {
            if (!(error instanceof view.NamespaceGeometryError)) throw error;
            // Invalid root geometry must not recurse through a fault renderer
            // that reads that same invalid Namespace.
            this.halted = true;
            this.running = false;
            this.faultLog.push({type: error.fault, message: error.message,
                rawDiagnosticReason: error.message, namespace: {...this.cr[15]}});
            return null;
        }
    }

    _execSwitch(d) {
        if (d.crDst !== 15) return super._execSwitch(d);
        const reject = (code, message) => { this.fault(code, `Namespace SWITCH: ${message}`); return null; };
        if (!Number.isInteger(d.crSrc) || d.crSrc < 0 || d.crSrc > 11 ||
                !Number.isInteger(d.imm) || d.imm < 0) {
            return reject('INVALID_OP', 'requires an ordinary source CR and a nonnegative C-List row');
        }
        if (this.cr[15].m !== 1) return reject('PERM_L', 'CR15.M was not set at acceptance');
        const source = this.cr[d.crSrc];
        const callClist = d.crSrc === 6 && source.m === 1 &&
            this.parseGT(source.word0).permissions.E === 1;
        const sourceCheck = this.mLoad(source.word0, callClist ? null : 'L', d.crSrc);
        if (!sourceCheck.ok) return reject(sourceCheck.fault, sourceCheck.message);
        const sourceBase = sourceCheck.entry.word0_location;
        const header = this.parseLumpHeader(this.memory[sourceBase]);
        const sourceNS = this.namespaceGeometry();
        if (!header.valid || header.typ !== 0 || !header.cc ||
                sourceBase < sourceNS.bodyStart || sourceBase + header.lumpSize > sourceNS.end ||
                header.cw + 1 > header.lumpSize - header.cc || d.imm >= header.cc) {
            return reject('BOUNDS', 'source C-List has invalid geometry or row');
        }
        const clistBase = sourceBase + header.lumpSize - header.cc;
        if (source.word1 !== (d.crSrc === 6 ? clistBase : sourceBase)) {
            return reject('BOUNDS', 'source CR does not describe the active Namespace C-List');
        }
        const gt = this.memory[clistBase + d.imm] >>> 0;
        const target = this.mLoad(gt, null, d.crSrc);
        if (!target.ok) return reject(target.fault, target.message);
        const root = {word0: gt, word1: target.entry.word0_location,
            word2: target.entry.word1_limit, word3: 0, m: 0};
        try { view.geometry(this.memory, root); }
        catch (error) {
            if (!(error instanceof view.NamespaceGeometryError)) throw error;
            return reject(error.fault, error.message);
        }
        if (!this._liveThreadOwned) return reject('TYPE', 'no outgoing Thread context is active');
        const outgoingCheck = this.mLoad(this.cr[12].word0, null, 12);
        if (!outgoingCheck.ok) return reject(outgoingCheck.fault, outgoingCheck.message);
        const outgoing = this.parseGT(this.cr[12].word0);
        const outgoingEntry = this.readNSEntry(outgoing.index);
        if (!outgoingEntry || outgoingEntry.word0_location !== this.cr[12].word1) {
            return reject('BOUNDS', 'outgoing CR12 does not describe the active Namespace Thread');
        }
        // Save with the old root still installed. No architectural rollback or
        // automatic Namespace/Thread generation change is attempted on fault.
        if (!this._suspendLiveThread(outgoing.index, null, this.pc + 1)) return null;
        this.cr[15] = root;
        this._liveThreadOwned = false;
        this._currentThreadSlot = null;
        const result = this._activateChangeThread(0x02000002, d, this.pc + 1, true);
        if (!result) return null;
        this.cr[13] = this.emptyCapability();
        result.desc = `Namespace SWITCH: ${result.desc}; CR13 and M cleared`;
        return result;
    }
}
if (typeof module !== 'undefined' && module.exports) module.exports = NamespaceRuntimeCore;
else root.ChurchNamespaceRuntimeCore = NamespaceRuntimeCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
