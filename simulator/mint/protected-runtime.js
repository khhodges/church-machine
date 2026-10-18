'use strict';

// The execution core, RAM, register banks and protected records never leave this
// module. The public facade is not a ChurchSimulator, and exposes no raw host
// mutators, observers, callbacks, event emitter or asynchronous image loader.
const Core = require('../namespace-runtime-core');
const combinedLSProfile = require('./combined-ls-profile');
const {PROFILE, OPS} = require('./protected-programs');
const P = require('./protected-policy');
const counters = require('./execution-counters');
const states = new WeakMap();
const need = P.requireThat;
const machine = (s, action) => {
    const st = states.get(s);
    if (!st) return action();
    st.machine++;
    try { return action(); } finally { st.machine--; }
};
const interval = (a, b, n) => a >= b && a < b + n;

class ProtectedCore extends combinedLSProfile(Core) {
    // No diagnostics accumulate private values, even before the first fault.
    emit() {}
    _emitTrace() {}
    _recordControlFlowDiagnostic() {}
    _captureFaultRoute() {}
    _captureCallTarget() {}
    _beginExecutionEvidence() {}
    _finishExecutionEvidence() {}
    getState() { return {protected: true}; }
    markLive() {} // GC is not an actor in this explicit profile.
    _fireSchedulerIRQ() { throw new Error('MINT_ACTIVATION'); }
    _dispatchAbstractCall() { this.fault('MINT_ACTIVATION'); return null; }
    _dispatchLoaderLoad() { this.fault('MINT_ACTIVATION'); return null; }
    _dispatchAbstractDread() { this.fault('MINT_IO'); return null; }
    _dispatchAbstractDwrite() { this.fault('MINT_IO'); return null; }
    fault(code) {
        const st = states.get(this);
        if (!st) return super.fault(code, 'Protected profile initialization failed');
        if (st.changeValidation) code = 'THREAD_CONTEXT';
        st.poisoned = true;
        st.fault = /^[A-Z_]+$/.test(code) ? code : 'MINT_FAULT';
        st.context = null;
        st.continuation = null;
        st.permit = null;
        this.halted = true;
        this.running = false;
        // Scrubbing is additional hygiene, not the observer access boundary.
        machine(this, () => {
            for (const r of st.plan.privateRanges) {
                if (r.scratch) for (let a = r.base; a < r.base + r.words; a++) this.memory[a] = 0;
            }
            for (let i = 0; i < 12; i++) if (i !== 5 && i !== 6) this._clearCR(i);
            for (let i = 1; i < 16; i++) if (i !== 5) this._writeDR(i, 0);
        });
        this.callStack = [];
        this.lambdaCachedFrame = null;
        this.output = '';
        this.auditLog = [];
        this.faultLog = [{type: st.fault, message: 'Protected execution stopped; provision a fresh isolated instance.'}];
    }
    _writeDR(...args) { return machine(this, () => super._writeDR(...args)); }
    _writeCR(...args) { return machine(this, () => super._writeCR(...args)); }
    _clearCR(...args) { return machine(this, () => super._clearCR(...args)); }
    _threadWrite(...args) { return machine(this, () => super._threadWrite(...args)); }
    _writeProtectedSto(...args) { return machine(this, () => super._writeProtectedSto(...args)); }
    _readProtectedCallFrame(...args) {
        return machine(this, () => super._readProtectedCallFrame(...args));
    }
    _execDwrite(d) {
        const st = states.get(this);
        st.homeSync = this._activeThreadBase() + 1 + d.crDst;
        try { return super._execDwrite(d); } finally { st.homeSync = null; }
    }
    _writeRuntimeWord(address, value) {
        const st = states.get(this);
        if (st && st.homeSync === address) {
            st.homeSync = null;
            return machine(this, () => super._writeRuntimeWord(address, value));
        }
        return super._writeRuntimeWord(address, value);
    }
    _execChange(d, continuation) {
        const st = states.get(this);
        need(!st.context && !st.continuation, 'MINT_ACTIVATION');
        // Fixed CR12 destination; the B field alone names the input GT.
        // Keep the historical engine/assembler unchanged outside this profile.
        need(d.crDst === 0 && d.imm === 0 && d.crSrc !== 13, 'INVALID_OP');
        const parsed = this.parseGT(this.cr[d.crSrc].word0);
        need(parsed.type === 1 && !parsed.malformed, 'THREAD_CONTEXT');
        need(!Object.values(parsed.permissions).some(Boolean), 'THREAD_PERMISSIONS');
        const slot = parsed.index;
        const entry = this.readNSEntry(slot);
        need(st.plan.threads.some(t => t.slot === slot && t.base === entry?.word0_location),
            'THREAD_CONTEXT');
        st.changeValidation = true;
        try {
            return machine(this, () => super._execChange({...d, crDst: d.crSrc}, continuation));
        } finally { st.changeValidation = false; }
    }
    _execSwitch(d) {
        const st = states.get(this);
        need(!st.context && !st.continuation, 'MINT_ACTIVATION');
        return machine(this, () => super._execSwitch(d));
    }
    mLoad(gt, perm, cr, address, range, ...rest) {
        const st = states.get(this);
        if (st && !st.machine) {
            if (st.poisoned) return {ok: false, fault: 'MINT_QUARANTINE'};
            const entry = this.readNSEntry(gt & 0xffff);
            if (entry) {
                const base = entry.word0_location;
                const limit = this.parseNSWord1(entry.word1_limit).limit;
                if (st.context && base >= this.memory.length) {
                    return {ok: false, fault: 'MINT_ACTIVATION'};
                }
                const slot = this.parseGT(this.cr[14].word0).index;
                const exactRole = name => {
                    if (slot !== st.plan.roles[name].slot ||
                        !['word0', 'word1', 'word2', 'word3'].every(k => this.cr[15][k] === st.plan.root[k])) return false;
                    try { P.role(this, st, name); return true; } catch (_) { return false; }
                };
                const isMint = exactRole('mint');
                const isVerifier = exactRole('verifier');
                for (const r of st.plan.privateRanges) {
                    const publicMintEntry = r.base === st.plan.roles.mint.base &&
                        gt === st.plan.roles.mint.enter && (perm === 'E' || perm === null);
                    // Root identity/activation is not table-as-data authority.
                    const publicRoot = r.base === 0 && gt === st.plan.root.word0 && perm === null;
                    if (base <= r.base + r.words - 1 && base + limit >= r.base &&
                        !(publicMintEntry || publicRoot || isMint && r.roles.includes('mint') ||
                            isVerifier && r.roles.includes('verifier'))) {
                        return {ok: false, fault: 'MINT_PRIVATE'};
                    }
                }
                // LOAD uses null for an M-authorized row/header read. That
                // waives the L bit, not the protected Thread storage boundary.
                const dataAccess = ['R', 'W', 'L', 'S'].includes(perm) ||
                    perm === null && address != null && Number.isInteger(cr) && cr <= 11;
                if (dataAccess &&
                    st.plan.threads.some(t => interval(base, t.base, t.words))) {
                    // Only the architectural heap view can read/write Thread
                    // data. Raw Thread aliases cannot reach homes or frames.
                    const layout = this._threadLayoutAtBase(this.cr[12].word1);
                    if (cr !== 5 || address != null &&
                        !interval(address, this.cr[12].word1 + layout.heapStart, layout.heapWords)) {
                        return {ok: false, fault: 'MINT_PRIVATE'};
                    }
                }
                if ((gt & 0xffff) === 14 && (!st.continuation || !isMint)) {
                    return {ok: false, fault: 'MINT_NSTAB'};
                }
                // NamespaceRuntimeCore intentionally rejects table-as-data in
                // its generic body check. The explicitly provisioned nstab RW
                // view is checked by the ordinary lower-level gate instead.
                if ((gt & 0xffff) === 14 && st.continuation && isMint) {
                    return require('../simulator').prototype.mLoad.call(
                        this, gt, perm, cr, address, range, ...rest);
                }
            }
        }
        // M authorizes L/S for this register only. It does not grant R/W,
        // export B, skip the private-range guards above, or mutate the GT.
        const accessPerm = ['L', 'S'].includes(perm) && this.cr[cr]?.m === 1 ? null : perm;
        return super.mLoad(gt, accessPerm, cr, address, range, ...rest);
    }
    _execCall(d) {
        const st = states.get(this);
        need(!st.continuation, 'MINT_LEAF');
        const target = (d.indexedSourceGT ?? this.cr[d.crDst].word0) >>> 0;
        const slot = this.parseGT(target).index;
        if (slot === st.plan.roles.mint.slot) {
            need(!st.context, 'MINT_OVERLAP');
            need(d.imm >= 1 && d.imm <= 5, 'MINT_METHOD');
            // Clear stale output before service admission, including failed
            // non-Create requests. Selector policy never becomes a grant.
            this._clearCR(1);
            st.pendingMethod = d.imm;
        } else if (slot === st.plan.roles.verifier.slot) {
            P.context(this, st);
            need(d.imm === 1 && st.context.stage === 'read', 'MINT_CONTEXT');
        } else {
            need(!st.context, 'MINT_ACTIVATION');
        }
        return super._execCall(d);
    }
    _execLambda(d) {
        const st = states.get(this), c = P.context(this, st);
        need(!st.continuation && !this.lambdaActive && d.crDst === 9, 'MINT_LEAF');
        const link = st.plan.roles.mint;
        need(this.cr[9].word0 === link.execute && this.mLoad(link.execute, 'X', 9).ok,
            'MINT_LAMBDA_LINK');
        need(c.stage === 'begun' || c.stage === 'prepared', 'MINT_CONTEXT');
        const entry = c.stage === 'begun' ? link.readEntry : link.commitEntry;
        const h = this.parseLumpHeader(this.memory[this.cr[14].word1]);
        need(entry >= 0 && entry < h.cw && this.pc + 1 < h.cw, 'MINT_LAMBDA_LINK');
        const previous = {pc: this.pc + 1, code: {...this.cr[14]}, scope: {...this.cr[6]},
            thread: this.cr[12].word0, sto: this._readProtectedSto(), entry};
        const result = super._execLambda(d);
        need(result && !this.halted, 'MINT_CONTINUATION');
        // Retain the existing one-word SZ=0 ABI, but commit it to protected
        // Thread RAM immediately; never let lambdaCachedFrame be authority.
        this._flushLambdaCache();
        this.lambdaCachedFrame = null;
        const frame = this._readProtectedCallFrame();
        need(frame.ok && frame.indicator.sz === 0 && frame.frame.returnPC === previous.pc,
            'MINT_CONTINUATION');
        st.continuation = {...previous, frameAddress: frame.frameAddress, packed: frame.packed};
        st.lambdaEntries++;
        this.pc = entry;
        return result;
    }
    _execReturn(d) {
        const st = states.get(this), c = st.context, continuation = st.continuation;
        const frame = this._readProtectedCallFrame();
        need(frame.ok && frame.threadBase !== null, 'MINT_CONTINUATION');
        const slot = this.parseGT(this.cr[14].word0).index;
        if (continuation) {
            P.context(this, st);
            need(frame.indicator.sz === 0 && frame.packed === continuation.packed &&
                frame.frameAddress === continuation.frameAddress &&
                frame.frame.savedSTO === continuation.sto &&
                frame.frame.returnPC === continuation.pc &&
                P.equal(Object.values(this.cr[14]), Object.values(continuation.code)) &&
                P.equal(Object.values(this.cr[6]), Object.values(continuation.scope)) &&
                this.cr[12].word0 === continuation.thread &&
                ['read', 'written'].includes(c.stage), 'MINT_CONTINUATION');
            this._clearCR(10);
        } else if (slot === st.plan.roles.verifier.slot) {
            P.context(this, st, 'verifier');
            need(c.stage === 'verified' && frame.companion === st.plan.roles.mint.enter &&
                frame.frame.returnPC === c.verifyReturn, 'MINT_CONTEXT');
        } else if (slot === st.plan.roles.mint.slot && st.pendingMethod) {
            need(!c && st.finished && d.imm === 2, 'MINT_FINISH');
        }
        // In this profile the host shadow is not used even to restore DR
        // snapshots. The protected Thread frame is the only continuation.
        this.callStack = [];
        const result = machine(this, () => super._execReturn(d));
        need(result && !this.halted, 'MINT_CONTINUATION');
        if (continuation) st.continuation = null;
        else if (slot === st.plan.roles.verifier.slot) c.stage = 'verified-return';
        else if (st.finished) { st.pendingMethod = null; st.finished = false; }
        st.protectedReturns++;
        return result;
    }
    _execLoad(d) {
        d = this._resolveCompactIndex(d);
        if (!d) return null;
        const st = states.get(this);
        const result = super._execLoad(d);
        if (result && d.crDst === 1 && st.context && st.context.stage === 'written') {
            need(d.crSrc === 8 && d.imm === 1 && this.cr[8].word0 === st.plan.views.resultL &&
                this.cr[1].word0 === st.context.result && !st.context.loaded, 'MINT_RESULT');
            need(this.mLoad(this.cr[1].word0, null, 1).ok, 'MINT_RESULT');
            st.context.loaded = true;
            st.context.stage = 'loaded';
        }
        return result;
    }
}

function writeGate(s, st, address, value) {
    need(!st.poisoned || st.machine, 'MINT_QUARANTINE');
    if (st.machine) return;
    const c = st.context, cell = st.plan.resultCell;
    if (address === cell) {
        const p = st.permit;
        need(c && st.continuation && p && p.context === c && value === p.gt &&
            P.equal(Array.from(s.memory.slice(c.slot * 4, c.slot * 4 + 4)), p.words),
        'MINT_RESULT_WRITE');
        st.permit = null;
        c.stage = 'written';
        return;
    }
    if (c) {
        // Ordinary instructions cannot mutate the request/proof/payload,
        // table, code, registry or allocation while admission is held.
        need(false, 'MINT_EXCLUSION');
    }
    need(st.allocations.some(a => interval(address, a.base, a.words)) ||
        st.plan.publicData?.some(a => interval(address, a.base, a.words)), 'MINT_WRITE');
}

function protectedOperation(s, st, op) {
    if (op === OPS.FAIL) throw Object.assign(new Error(), {code: 'MINT_DENIED'});
    if (op === OPS.BEGIN) {
        P.role(s, st, 'mint');
        need(!st.context && !st.poisoned && st.pendingMethod >= 1 && st.pendingMethod <= 5, 'MINT_OVERLAP');
        const frame = s._readProtectedCallFrame();
        need(frame.ok && frame.threadBase !== null && frame.indicator.sz === 1 &&
            frame.companion === st.plan.roles.mint.enter, 'MINT_REQUESTER');
        // Establish exclusion *before* capturing any mutable input.
        const c = st.context = {thread: s.cr[12].word0, threadBase: s.cr[12].word1,
            root: Object.values(s.cr[15]).slice(0, 4), caller: frame.companion,
            credential: s.cr[2].word0, registryRevision: st.registry.revision, stage: 'capturing'};
        // Empty target sets and absent Genesis administration authority are
        // permanent restrictions of the approved first credential.
        need(st.pendingMethod === 1, st.pendingMethod <= 3 ? 'MINT_TARGET_GRANT' : 'MINT_ADMIN');
        Object.assign(c, P.decodeRequest(s, st));
        machine(s, () => {
            c.proof.forEach((v, i) => { s.memory[st.plan.proofSnapshot + i] = v; });
            c.payload.forEach((v, i) => { s.memory[st.plan.payloadSnapshot + i] = v; });
            [...c.request, 1, ++st.admissions, 0, 0, 0, st.registry.revision, 0, 0]
                .forEach((v, i) => { s.memory[st.plan.frozenRequest + i] = v; });
            [0, 0, 0, 9, ...st.plan.namespaceId, st.admissions, 0, 0, 0]
                .forEach((v, i) => { s.memory[st.plan.requesterContext + i] = v; });
            s.memory[st.plan.resultCell] = 0;
        });
        c.proof.fill(0);
        delete c.proof;
        c.payloadWords = c.payload.length;
        // Payload authority lives in protected RAM throughout verification;
        // do not leave a second host-array copy as the installation source.
        c.payload.fill(0);
        delete c.payload;
        s._clearCR(1);
        c.stage = 'begun';
    } else if (op === OPS.VERIFY_CONTEXT) {
        const c = P.verifyGrant(s, st), frame = s._readProtectedCallFrame();
        need(c.stage === 'read' && frame.ok &&
            frame.companion === st.plan.roles.mint.enter && frame.indicator.sz === 1,
        'MINT_CONTEXT');
        need(s.cr[2].word0 === c.credential &&
            s.cr[3].word0 === st.plan.views.proofSnapshot &&
            s.cr[4].word0 === st.plan.views.frozenRequest &&
            s.cr[7].word0 === st.plan.views.requesterContext, 'MINT_CONTEXT');
        c.verifyReturn = frame.frame.returnPC;
        c.stage = 'verifying';
        // No caller-provided expectation enters the separately provisioned
        // registry. The verifier obtains both read views from its own C-list.
    } else if (op === OPS.VERIFIED) {
        const c = P.verifyGrant(s, st);
        need(c.stage === 'verifying' && s.dr[7] === 0 && c.proofReads === 8, 'MINT_PROOF');
        c.stage = 'verified';
        st.comparedWords += 4;
        for (let i = 1; i < 16; i++) if (i !== 5) s._writeDR(i, 0);
        s._writeDR(1, 1);
    } else if (op === OPS.READ) {
        const c = P.context(s, st);
        need(st.continuation && c.stage === 'begun' && s.cr[10].word0 === st.plan.views.nstab,
            'MINT_NSTAB');
        c.slot = st.plan.freeSlots.find(slot => !st.usedSlots.has(slot));
        need(c.slot !== undefined, 'MINT_EXHAUSTED');
        for (let i = 0; i < 4; i++) need(s.mLoad(s.cr[10].word0, 'R', 10,
            c.slot * 4 + i).ok, 'MINT_NSTAB');
        c.old = Array.from(s.memory.slice(c.slot * 4, c.slot * 4 + 4));
        need(c.old.every(v => v === 0), 'MINT_SLOT_HISTORY');
        counters.tableAccess(st.evidence, 'dataReads');
        c.stage = 'read';
    } else if (op === OPS.CHECK_LIVE_USE) {
        const c = P.context(s, st);
        need(c.stage === 'verified-return', 'MINT_CONTEXT');
        const live = machine(s, () => P.liveDependencies(s, st));
        need(!live.has(c.slot), 'MINT_LIVE_TARGET');
        c.liveChecked = true;
    } else if (op === OPS.PREPARE) {
        const c = P.context(s, st);
        need(c.stage === 'verified-return' && c.liveChecked && s.dr[1] === 1, 'MINT_PROOF');
        const base = Math.ceil(st.nextBlock / c.size) * c.size;
        need(base + c.size <= st.plan.allocationEnd, 'MINT_EXHAUSTED');
        c.base = base;
        const rights = [{}, {E: 1}, {L: 1, S: 1}, {L: 1, S: 1}, {R: 1, W: 1}][c.type];
        c.result = s.createGT(0, c.slot, {...rights, B: c.bind}, 1) >>> 0;
        const w1 = s.packNSWord1(c.size - 1, 0, 0, 0);
        c.words = [base, w1, s._integrity32(base, w1), c.result];
        machine(s, () => {
            for (let i = 0; i < c.size; i++) s.memory[base + i] =
                i < c.payloadWords ? s.memory[st.plan.payloadSnapshot + i] : 0;
            if (c.type === 1 || c.type === 3) {
                const header = s.parseLumpHeader(s.memory[base]);
                s.memory[base + c.size - header.cc] = c.result;
            }
        });
        c.stage = 'prepared';
    } else if (op === OPS.COMMIT) {
        const c = P.context(s, st);
        need(st.continuation && c.stage === 'prepared' && s.cr[10].word0 === st.plan.views.nstab &&
            P.equal(Array.from(s.memory.slice(c.slot * 4, c.slot * 4 + 4)), c.old),
        'MINT_OLD_WORDS');
        need(c.liveChecked && !machine(s, () => P.liveDependencies(s, st)).has(c.slot),
            'MINT_LIVE_TARGET');
        for (let i = 0; i < 4; i++) need(s.mLoad(s.cr[10].word0, 'W', 10,
            c.slot * 4 + i).ok, 'MINT_NSTAB');
        // Four writes reach the real private backing RAM. A cut never writes
        // the unaccepted remainder; the entire instance remains quarantined.
        for (let i = 0; i < 4; i++) {
            machine(s, () => { s.memory[c.slot * 4 + i] = c.words[i]; });
            st.completedWrites++;
            cut(s, st, `write-${i}`);
        }
        const actual = Array.from(s.memory.slice(c.slot * 4, c.slot * 4 + 4));
        need(P.equal(actual, c.words), 'MINT_READBACK');
        counters.tableAccess(st.evidence, 'dataWrites');
        need(s.mLoad(c.result, null).ok, 'MINT_RESULT');
        machine(s, () => { s.memory[2]++; });
        st.usedSlots.add(c.slot);
        st.nextBlock = c.base + c.size;
        st.allocations.push({base: c.base, words: c.size, slot: c.slot, gt: c.result});
        if (c.type === 2) st.plan.threads.push({slot: c.slot, base: c.base, words: c.size});
        st.permit = {context: c, gt: c.result, words: actual};
        c.stage = 'published';
        s._writeDR(2, c.result);
        cut(s, st, 'published');
    } else if (op === OPS.CLEAN) {
        const c = P.context(s, st);
        need(c.stage === 'loaded' && c.loaded && !st.permit && s.cr[1].word0 === c.result,
            'MINT_RESULT');
        machine(s, () => { s.memory[st.plan.resultCell] = 0; });
        for (let i = 2; i < 12; i++) if (i !== 5 && i !== 6) s._clearCR(i);
        for (let i = 2; i < 16; i++) if (i !== 5) s._writeDR(i, 0);
        c.stage = 'clean';
    } else if (op === OPS.FINISH) {
        const c = P.context(s, st);
        need(c.stage === 'clean' && !st.permit && !st.continuation, 'MINT_FINISH');
        st.lastResult = c.result;
        machine(s, () => {
            for (const r of st.plan.privateRanges.filter(r => r.scratch)) {
                for (let a = r.base; a < r.base + r.words; a++) s.memory[a] = 0;
            }
        });
        st.context = null;
        st.finished = true;
        s._writeDR(1, 1);
    } else need(false, 'MINT_OPCODE');
    s.pc++;
}

function cut(s, st, point) {
    if (st.plan.faultAt === point) {
        s.fault('MINT_INJECTED');
        need(false, 'MINT_INJECTED');
    }
}

function provision(plan) {
    // Trust boundary: only the authorized isolated initializer calls provision.
    // Deep-copy all authority and bytes; later edits to its input have no effect.
    const p = structuredClone(plan);
    const canonical = require('./provision-validation').validate(p);
    const s = new ProtectedCore(p.memory, p.root);
    delete p.memory;
    const st = {plan: p, registry: p.registry, machine: 0, context: null, permit: null,
        poisoned: false, fault: null, admissions: 0, steps: 0, completedWrites: 0,
        usedSlots: new Set(), allocations: [], nextBlock: p.allocationStart, finished: false,
        lambdaEntries: 0, protectedReturns: 0, comparedWords: 0,
        evidence: p.evidence?.enabled ? counters.create() : null};
    states.set(s, st);
    // Registry proof is initialized from independent trusted issuance state,
    // never from the client proof buffer.
    machine(s, () => p.registry.proof.forEach((v, i) => { s.memory[p.registryBase + i] = v; }));
    p.registry.proof.fill(0);
    delete p.registry.proof;
    const raw = s.memory;
    s.memory = new Proxy(raw, {
        get(target, key) {
            if (key === 'set' || key === 'fill' || key === 'copyWithin' || key === 'reverse' || key === 'sort') {
                return (...args) => {
                    need(st.machine, 'MINT_EXCLUSION');
                    return target[key](...args);
                };
            }
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, key, value) {
            need(/^(0|[1-9][0-9]*)$/.test(String(key)), 'MINT_WRITE');
            const address = Number(key);
            need(address < target.length, 'MINT_WRITE');
            writeGate(s, st, address, value >>> 0);
            const drop = st.plan.dropPublicationWord;
            if (!(Number.isInteger(drop) && st.context?.stage === 'prepared' &&
                address === st.context.slot * 4 + drop)) target[address] = value >>> 0;
            return true;
        },
    });
    machine(s, () => need(s.startEntryThread(), 'MINT_ENTRY'));
    // The actual protected startup resume frame selected this compiled entry.
    // No host PC assignment or synthetic service CALL frame is used.
    need(s.parseGT(s.cr[14].word0).index !== 9 ||
        ['caller', 'caller_method_2', 'caller_method_3', 'caller_method_4', 'caller_method_5']
            .some(label => s.pc === canonical.mint.labels[label]), 'MINT_ENTRY');
    const status = () => Object.freeze({
        profile: PROFILE, halted: s.halted, fault: st.fault, quarantined: st.poisoned,
        phase: st.context?.stage || (st.finished ? 'finishing' : 'idle'),
        steps: st.steps, admissions: st.admissions, completedWrites: st.completedWrites,
        lambdaEntries: st.lambdaEntries, protectedReturns: st.protectedReturns,
        comparedWords: st.comparedWords,
        publications: st.allocations.length, privateDescriptors: p.privateSlots.length,
        memberCount: s.memory[2],
        result: !st.context && !st.poisoned ? st.lastResult || 0 : 0,
        useConfirmed: !st.context && !st.poisoned && st.lastResult === s.cr[1].word0 &&
            s.dr[3] === 73 && st.allocations.some(a => a.gt === st.lastResult && s.memory[a.base] === 73),
        ...(st.evidence ? {execution: counters.snapshot(st.evidence)} : {}),
    });
    return Object.freeze({
        status,
        step() {
            if (s.halted || st.poisoned) return status();
            try {
                need(++st.steps <= 20000, 'MINT_WATCHDOG');
                const fetch = s._fetchInstruction();
                need(fetch && fetch.ok !== false, 'MINT_FETCH');
                const word = s.memory[fetch.addr] >>> 0, d = s.decodeInstruction(word);
                const before = st.evidence ? counters.before(s) : null;
                let retired;
                if (st.context) P.context(s, st,
                    s.parseGT(s.cr[14].word0).index === 15 ? 'verifier' : 'mint');
                need(![8, 9, 10, 12, 13, 14, 15, 26, 27, 28, 29, 31].includes(d.opcode),
                    'MINT_ACTIVATION');
                if (st.continuation) need(![2, 4, 5, 7].includes(d.opcode), 'MINT_LEAF');
                if (d.opcode === 11) {
                    need(d.cond === 14 && (word & 0x7fffff) === d.imm, 'MINT_OPCODE');
                    protectedOperation(s, st, d.imm);
                } else {
                    if (st.context?.stage === 'verifying' && d.opcode === 16 &&
                        [3, 4].includes(d.crSrc)) {
                        st.context.proofReads = (st.context.proofReads || 0) + 1;
                    }
                    retired = s.step();
                    need(retired || s.halted, 'MINT_EXECUTION');
                }
                if (before && !st.poisoned) counters.record(st.evidence, s, before, retired);
                if (st.context?.stage === 'written') cut(s, st, 'result-written');
                if (st.context?.stage === 'loaded') cut(s, st, 'loaded');
                if (st.context?.stage === 'clean') cut(s, st, 'clean');
                const point = st.continuation ? `${st.context?.stage}-lambda` :
                    st.context?.stage || (st.finished ? 'finished' :
                        st.pendingMethod ? 'mint-entry' : 'idle');
                require('./fault-injection').inject(s, st, point, protectedOperation, OPS);
                if (st.corruptAddress !== undefined) {
                    // Physical upset bypasses the memory interlock, unlike an
                    // ordinary writer. It does not construct valid authority.
                    raw[st.corruptAddress] ^= 1;
                    delete st.corruptAddress;
                }
                // No plaintext proof or CR/DR values survive in diagnostics.
                s.output = ''; s.auditLog = []; s._executionAttempt = null;
                s.callStack = [];
            } catch (e) { if (!st.poisoned) s.fault(e.code || 'MINT_EXECUTION'); }
            return status();
        },
        // Every asynchronous producer/observer uses this single non-reentrant
        // boundary. No operation accepts a callback or yields the private core.
        control(action) {
            if (action === 'pause' || action === 'snapshot') return status();
            s.fault(action === 'reset' ? 'MINT_RESET' : 'MINT_EXCLUSION');
            return status();
        },
    });
}
module.exports = Object.freeze({provision, PROFILE});
