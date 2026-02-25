class ChurchSimulator {
    constructor() {
        this._listeners = {};
        this.NS_TABLE_BASE = 0xFD00;
        this.NS_ENTRY_WORDS = 3;
        this.MAX_NS_ENTRIES = 256;
        this.SLOT_SIZE = 0x100;
        this.reset();
    }

    on(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    }

    emit(event, data) {
        (this._listeners[event] || []).forEach(fn => fn(data));
    }

    reset() {
        this.cr = [];
        for (let i = 0; i < 16; i++) {
            this.cr[i] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
        }

        this.dr = new Array(16).fill(0);

        this.pc = 0;
        this.flags = { N: false, Z: false, C: false, V: false };
        this.running = false;
        this.halted = false;
        this.stepCount = 0;
        this.output = '';
        this.callStack = [];
        this.lambdaActive = false;
        this.lambdaReturnPC = 0;
        this.faultLog = [];

        this.memory = new Uint32Array(65536);

        this.nsLabels = {};
        this.nsCount = 0;
        this.gcPolarity = 0;
        this.nsHandlers = {};
        this.nsClistMap = {};

        this.bootComplete = false;
        this.mElevation = false;
        this.bootStep = 0;
        this.lastCapability = null;

        this._initNamespaceTable();
        this.output += '--- HARD RESET: all registers zeroed ---\n';
        this.output += 'Boot microcode ready. Step or Run to begin boot sequence.\n';
        this.emit('reset', {});
        this.emit('stateChange', this.getState());
    }

    packNSWord1(limit17, bFlag, fFlag, gBit, chainable, gtType) {
        return (
            ((bFlag & 1) << 31) |
            ((fFlag & 1) << 30) |
            ((gBit & 1) << 29) |
            ((chainable & 1) << 28) |
            ((gtType & 3) << 26) |
            (limit17 & 0x1FFFF)
        ) >>> 0;
    }

    parseNSWord1(word1) {
        return {
            b: (word1 >>> 31) & 1,
            f: (word1 >>> 30) & 1,
            g: (word1 >>> 29) & 1,
            chainable: (word1 >>> 28) & 1,
            gtType: (word1 >>> 26) & 3,
            limit: word1 & 0x1FFFF,
        };
    }

    packLimitWord(limit17, bFlag, fFlag) {
        return this.packNSWord1(limit17, bFlag, fFlag, 0, 0, 0);
    }

    parseLimitWord(word1) {
        return this.parseNSWord1(word1);
    }

    writeNSEntry(idx, location, limit17, bFlag, fFlag, gBit, chainable, gtType, version) {
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        this.memory[base + 0] = location >>> 0;
        this.memory[base + 1] = this.packNSWord1(limit17, bFlag, fFlag, gBit, chainable, gtType);
        this.memory[base + 2] = this.makeVersionSeals(version || 0, location, limit17);
        if (idx >= this.nsCount) this.nsCount = idx + 1;
    }

    readNSEntry(idx) {
        if (idx < 0 || idx >= this.MAX_NS_ENTRIES) return null;
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        const w0 = this.memory[base + 0];
        const w1 = this.memory[base + 1];
        const w2 = this.memory[base + 2];
        if (w0 === 0 && w1 === 0) return null;
        const parsed = this.parseNSWord1(w1);
        return {
            word0_location: w0,
            word1_limit: w1,
            word2_seals: w2,
            gBit: parsed.g,
            gtType: parsed.gtType,
            chainable: parsed.chainable ? true : false,
            label: this.nsLabels[idx] || '',
        };
    }

    isNSEntryValid(idx) {
        if (idx < 0 || idx >= this.MAX_NS_ENTRIES) return false;
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        return (this.memory[base] !== 0 || this.memory[base + 1] !== 0);
    }

    get namespaceTable() {
        const entries = [];
        for (let i = 0; i < this.nsCount; i++) {
            entries.push(this.readNSEntry(i));
        }
        return entries;
    }

    _initNamespaceTable() {
        this.nsLabels = {};
        this.nsCount = 0;
        const abstractions = [
            { label: 'Boot.CList', perms: {R:0,W:0,X:0,L:1,S:1,E:0}, chainable: false },
            { label: 'Boot.CLOOMC',perms: {R:0,W:0,X:1,L:0,S:0,E:0}, chainable: false },
            { label: 'Threads',    perms: {R:0,W:0,X:0,L:1,S:1,E:1}, chainable: false },
            { label: 'Lambda',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'SlideRule',  perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: true },
            { label: 'Abacus',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: true },
            { label: 'Constants',  perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Stack',      perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: true },
            { label: 'SUCC',       perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'PRED',       perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'ADD',        perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'SUB',        perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'MUL',        perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'DIV',        perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'POW',        perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'SQRT',       perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'LOG',        perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'EXP',        perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'ISZERO',     perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'LEQ',        perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'TRUE',       perms: {R:0,W:0,X:0,L:1,S:0,E:0}, chainable: false },
            { label: 'FALSE',      perms: {R:0,W:0,X:0,L:1,S:0,E:0}, chainable: false },
            { label: 'PAIR',       perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'FST',        perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'SND',        perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'GC',         perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false, handler: 'gc' },
        ];
        const clistChildren = [];
        for (let i = 0; i < abstractions.length; i++) {
            const a = abstractions[i];
            const loc = i * this.SLOT_SIZE;
            const lim17 = 0xFF;
            const gtWord = this.createGT(0, i, a.perms, 0);
            this.writeNSEntry(i, loc, lim17, 0, 0, 0, a.chainable ? 1 : 0, 0, 0);
            this.nsLabels[i] = a.label;
            this.memory[loc] = gtWord;
            if (a.handler) {
                this.nsHandlers[i] = a.handler;
            }
            clistChildren.push(i);
        }
        this.nsClistMap[0] = clistChildren;
    }

    _bootStep() {
        if (this.bootComplete) return false;

        switch (this.bootStep) {
            case 0:
                for (let i = 0; i < 16; i++) {
                    if (this.cr[i].word0 !== 0 || this.cr[i].word1 !== 0 || this.cr[i].m !== 0) {
                        this.fault('BOOT', 'Boot invariant: CRs must be zero at boot entry');
                        return false;
                    }
                }
                this.mElevation = true;
                this.output += '[M] Boot microcode: M elevation ACTIVE\n';
                this.bootStep++;
                break;
            case 1: {
                const entry = this.readNSEntry(0);
                const gt15 = this.createGT(0, 0, {R:0,W:0,X:0,L:0,S:0,E:0}, 0);
                this._writeCR(15, gt15, entry);
                this.output += '[M] CR15 ← Namespace root (gift from heaven, no permissions)\n';
                this.bootStep++;
                break;
            }
            case 2: {
                const entry = this.readNSEntry(2);
                const gt8 = this.createGT(0, 2, {R:0,W:0,X:0,L:0,S:0,E:0}, 0);
                this._writeCR(8, gt8, entry);
                this.output += '[M] CR8 ← Boot thread (gift from heaven, no permissions)\n';
                this.bootStep++;
                break;
            }
            case 3: {
                const entry = this.readNSEntry(0);
                const gt6 = this.createGT(0, 0, {R:0,W:0,X:0,L:0,S:0,E:0}, 0);
                this._writeCR(6, gt6, entry);
                this.output += '[M] CR6 ← Boot C-List (gift from heaven, no permissions — M gate handles access)\n';
                this.bootStep++;
                break;
            }
            case 4: {
                const entry = this.readNSEntry(1);
                const gt7 = this.createGT(0, 1, {R:0,W:0,X:0,L:0,S:0,E:0}, 0);
                this._writeCR(7, gt7, entry);
                this.output += '[M] CR7 ← Boot CLOOMC (gift from heaven, executable code block)\n';
                this.bootStep++;
                break;
            }
            case 5:
                this.mElevation = false;
                this.bootComplete = true;
                this.output += '[M] Boot microcode: M elevation OFF — boot complete\n';
                break;
        }
        this.emit('stateChange', this.getState());
        return true;
    }

    parseGT(gt32) {
        gt32 = gt32 >>> 0;
        const version = (gt32 >>> 25) & 0x7F;
        const index = (gt32 >>> 8) & 0x1FFFF;
        const permBits = (gt32 >>> 2) & 0x3F;
        const type = gt32 & 0x3;
        return {
            version, index,
            permissions: {
                R: (permBits >>> 0) & 1,
                W: (permBits >>> 1) & 1,
                X: (permBits >>> 2) & 1,
                L: (permBits >>> 3) & 1,
                S: (permBits >>> 4) & 1,
                E: (permBits >>> 5) & 1,
            },
            type,
            typeName: ['Inform','Outform','NULL','Abstract'][type & 3],
        };
    }

    createGT(version, index, perms, type) {
        const v = ((version & 0x7F) << 25) >>> 0;
        const i = ((index & 0x1FFFF) << 8) >>> 0;
        const p = (this.getPermBits(perms) << 2) >>> 0;
        const t = type & 0x3;
        return (v | i | p | t) >>> 0;
    }

    getPermBits(permsObj) {
        let bits = 0;
        if (permsObj.R) bits |= 1;
        if (permsObj.W) bits |= 2;
        if (permsObj.X) bits |= 4;
        if (permsObj.L) bits |= 8;
        if (permsObj.S) bits |= 16;
        if (permsObj.E) bits |= 32;
        return bits & 0x3F;
    }

    computeSeal(location, limit17) {
        let h = 0x5A5A5A5A;
        h = ((h ^ location) * 0x01000193) >>> 0;
        h = ((h ^ limit17) * 0x01000193) >>> 0;
        h = (h ^ (h >>> 16)) >>> 0;
        return h & 0x01FFFFFF;
    }

    makeVersionSeals(version, location, limit17) {
        const seal = this.computeSeal(location, limit17);
        return (((version & 0x7F) << 25) | (seal & 0x01FFFFFF)) >>> 0;
    }

    validateMAC(entry) {
        if (!entry) return false;
        const storedSeal = entry.word2_seals & 0x01FFFFFF;
        const lim = this.parseNSWord1(entry.word1_limit);
        return storedSeal === this.computeSeal(entry.word0_location, lim.limit);
    }

    mLoad(gt32, requiredPerm) {
        const parsed = this.parseGT(gt32);
        if (parsed.index >= this.nsCount) {
            return { ok: false, fault: 'BOUNDS', message: `namespace index ${parsed.index} out of bounds` };
        }
        const entry = this.readNSEntry(parsed.index);
        if (!entry) {
            return { ok: false, fault: 'BOUNDS', message: `namespace entry ${parsed.index} is null` };
        }
        const nsWord1 = this.parseNSWord1(entry.word1_limit);
        const nsVersion = (entry.word2_seals >>> 25) & 0x7F;
        const versionMatch = parsed.version === nsVersion;
        const sealValid = this.validateMAC(entry);
        this.lastCapability = {
            op: requiredPerm,
            label: this.nsLabels[parsed.index] || 'entry_'+parsed.index,
            perms: parsed.permissions,
            b: nsWord1.b,
            f: nsWord1.f,
            versionMatch,
            sealValid,
        };
        if (!versionMatch) {
            return { ok: false, fault: 'VERSION', message: `version mismatch: GT v${parsed.version}, entry v${nsVersion}` };
        }
        if (!sealValid) {
            return { ok: false, fault: 'SEAL', message: `FNV seal validation failed for entry ${parsed.index}` };
        }
        if (requiredPerm !== null && !this.mElevation && !parsed.permissions[requiredPerm]) {
            return { ok: false, fault: 'PERMISSION', message: `lacks ${requiredPerm} permission` };
        }
        this.markLive(parsed.index);
        return { ok: true, parsed, entry, index: parsed.index };
    }

    markLive(idx) {
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        const w1 = this.memory[base + 1];
        if (this.gcPolarity === 0) {
            this.memory[base + 1] = (w1 | (1 << 29)) >>> 0;
        } else {
            this.memory[base + 1] = (w1 & ~(1 << 29)) >>> 0;
        }
    }

    markGarbage(idx) {
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        const w1 = this.memory[base + 1];
        if (this.gcPolarity === 0) {
            this.memory[base + 1] = (w1 & ~(1 << 29)) >>> 0;
        } else {
            this.memory[base + 1] = (w1 | (1 << 29)) >>> 0;
        }
    }

    getGBit(idx) {
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        return (this.memory[base + 1] >>> 29) & 1;
    }

    isGarbage(idx) {
        return this.getGBit(idx) === this.gcPolarity;
    }

    runGC() {
        const log = [];
        const garbageValue = this.gcPolarity;
        const liveValue = garbageValue ? 0 : 1;
        log.push('=== PP250 Deterministic Garbage Collection ===');
        log.push(`GC polarity: G=${garbageValue} means GARBAGE, G=${liveValue} means LIVE`);
        log.push('');

        log.push('--- Phase 1: MARK — set G=garbage on all valid entries ---');
        const priorCount = this.nsCount;
        let markCount = 0;
        for (let i = 0; i < priorCount; i++) {
            if (!this.isNSEntryValid(i)) continue;
            this.markGarbage(i);
            markCount++;
        }
        log.push(`Marked ${markCount} entries as garbage suspects (G=${garbageValue}).`);
        log.push('');

        log.push('--- Phase 2: SCAN — walk CRs + call stack, confirm live entries ---');
        const liveSet = new Set();
        for (let cr = 0; cr < 16; cr++) {
            const gt32 = this.cr[cr].word0;
            if (gt32 === 0) continue;
            const parsed = this.parseGT(gt32);
            const idx = parsed.index;
            if (idx < this.nsCount && this.isNSEntryValid(idx)) {
                this.markLive(idx);
                liveSet.add(idx);
                const label = this.nsLabels[idx] || '(unnamed)';
                log.push(`  CR${cr} → NS[${idx}] "${label}" — LIVE (G=${liveValue})`);
            }
        }
        if (this.callStack) {
            for (const frame of this.callStack) {
                for (const crKey of ['cr5', 'cr6', 'cr7']) {
                    if (frame[crKey]) {
                        const gt32 = frame[crKey].word0;
                        if (gt32 === 0) continue;
                        const parsed = this.parseGT(gt32);
                        const idx = parsed.index;
                        if (idx < this.nsCount && this.isNSEntryValid(idx) && !liveSet.has(idx)) {
                            this.markLive(idx);
                            liveSet.add(idx);
                            const label = this.nsLabels[idx] || '(unnamed)';
                            log.push(`  CallStack ${crKey} → NS[${idx}] "${label}" — LIVE (G=${liveValue})`);
                        }
                    }
                }
            }
        }
        const tracedFromClist = new Set();
        const traceQueue = [...liveSet];
        while (traceQueue.length > 0) {
            const parentIdx = traceQueue.shift();
            if (tracedFromClist.has(parentIdx)) continue;
            tracedFromClist.add(parentIdx);
            const children = this.nsClistMap[parentIdx];
            if (!children) continue;
            for (const childIdx of children) {
                if (liveSet.has(childIdx)) continue;
                if (childIdx < this.nsCount && this.isNSEntryValid(childIdx)) {
                    this.markLive(childIdx);
                    liveSet.add(childIdx);
                    traceQueue.push(childIdx);
                    const label = this.nsLabels[childIdx] || '(unnamed)';
                    log.push(`  C-List NS[${parentIdx}] → NS[${childIdx}] "${label}" — LIVE (G=${liveValue})`);
                }
            }
        }
        log.push(`Scan complete: ${liveSet.size} live entries confirmed.`);
        log.push('');

        log.push(`--- Phase 3: SWEEP — find entries where G=${garbageValue} (garbage) ---`);
        const candidates = [];
        for (let i = 0; i < priorCount; i++) {
            if (!this.isNSEntryValid(i)) continue;
            if (!this.isGarbage(i)) continue;
            const entry = this.readNSEntry(i);
            const label = this.nsLabels[i] || '(unnamed)';
            const loc = entry ? (entry.word0_location >>> 0) : 0;
            candidates.push({ index: i, label, loc });
            log.push(`  GARBAGE NS[${i}] "${label}" @ 0x${loc.toString(16).toUpperCase().padStart(8,'0')} — G=${garbageValue}`);
        }
        log.push(`Identified ${candidates.length} garbage entries.`);
        log.push('');

        log.push(`--- Phase 4: CLEAR — zero NS entries + free object memory ---`);
        let freedSlots = 0;
        let freedWords = 0;
        for (const c of candidates) {
            const base = this.NS_TABLE_BASE + c.index * this.NS_ENTRY_WORDS;
            const w2 = this.memory[base + 2];
            const oldVersion = (w2 >>> 25) & 0x7F;
            const newVersion = (oldVersion + 1) & 0x7F;
            this.memory[base + 0] = 0;
            this.memory[base + 1] = 0;
            this.memory[base + 2] = (newVersion << 25) >>> 0;

            let wordsCleared = 0;
            for (let w = 0; w < this.SLOT_SIZE; w++) {
                if (this.memory[c.loc + w] !== 0) {
                    this.memory[c.loc + w] = 0;
                    wordsCleared++;
                }
            }
            freedWords += wordsCleared;
            log.push(`  CLEAR NS[${c.index}] "${c.label}" — version ${oldVersion}→${newVersion}, ${wordsCleared} object words zeroed`);

            delete this.nsLabels[c.index];
            freedSlots++;
        }

        let newCount = 0;
        for (let i = priorCount - 1; i >= 0; i--) {
            if (this.isNSEntryValid(i)) {
                newCount = i + 1;
                break;
            }
        }
        this.nsCount = newCount;

        this.gcPolarity = this.gcPolarity ? 0 : 1;

        log.push('');
        log.push(`=== GC Complete: ${freedSlots} slots freed, ${freedWords} object memory words reclaimed ===`);
        log.push(`Namespace: ${priorCount} → ${this.nsCount} entries (${freedSlots} swept)`);
        log.push(`Live: ${liveSet.size} entries protected by CR references`);
        log.push(`Next GC polarity flipped: G=${this.gcPolarity} will mean GARBAGE`);

        const report = log.join('\n');
        this.output += report + '\n';
        this.emit('stateChange', this.getState());
        return { freedSlots, freedWords, liveCount: liveSet.size, report };
    }

    _writeCR(crIdx, gt32, entry) {
        const existing = this.cr[crIdx].word0;
        if (existing !== 0 && !this.mElevation) {
            this.fault('CR_OCCUPIED', `CR${crIdx} holds active GT 0x${existing.toString(16).toUpperCase().padStart(8,'0')} — clear first`);
            return false;
        }
        this.cr[crIdx].word0 = gt32;
        this.cr[crIdx].word1 = entry.word0_location >>> 0;
        this.cr[crIdx].word2 = entry.word1_limit >>> 0;
        this.cr[crIdx].word3 = entry.word2_seals >>> 0;
        this.cr[crIdx].m = this.mElevation ? 1 : 0;
        return true;
    }

    _clearCR(crIdx) {
        this.cr[crIdx] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    }

    checkCondition(condCode) {
        const { N, Z, C, V } = this.flags;
        switch (condCode) {
            case 0x0: return Z;
            case 0x1: return !Z;
            case 0x2: return C;
            case 0x3: return !C;
            case 0x4: return N;
            case 0x5: return !N;
            case 0x6: return V;
            case 0x7: return !V;
            case 0x8: return C && !Z;
            case 0x9: return !C || Z;
            case 0xA: return N === V;
            case 0xB: return N !== V;
            case 0xC: return !Z && (N === V);
            case 0xD: return Z || (N !== V);
            case 0xE: return true;
            case 0xF: return false;
            default: return true;
        }
    }

    condName(code) {
        return ['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','AL','NV'][code & 0xF];
    }

    opName(code) {
        const names = ['LOAD','SAVE','CALL','RETURN','CHANGE','SWITCH','TPERM','LAMBDA','ELOADCALL','XLOADLAMBDA','DREAD','DWRITE','BFEXT','BFINS','MCMP','IADD','ISUB','BRANCH'];
        return names[code] || '???';
    }

    decodeInstruction(instr) {
        instr = instr >>> 0;
        return {
            opcode: (instr >>> 27) & 0x1F,
            cond:   (instr >>> 23) & 0xF,
            crDst:  (instr >>> 19) & 0xF,
            crSrc:  (instr >>> 15) & 0xF,
            imm:    instr & 0x7FFF,
            raw:    instr,
        };
    }

    encodeInstruction(opcode, cond, crDst, crSrc, imm) {
        return (
            ((opcode & 0x1F) << 27) |
            ((cond & 0xF) << 23) |
            ((crDst & 0xF) << 19) |
            ((crSrc & 0xF) << 15) |
            (imm & 0x7FFF)
        ) >>> 0;
    }

    fault(type, message) {
        const entry = { type, message, pc: this.pc, step: this.stepCount };
        this.faultLog.push(entry);
        this.output += `FAULT [${type}] at PC=${this.pc}: ${message}\n`;
        this.halted = true;
        this.running = false;
        this.emit('fault', entry);
        this.emit('output', this.output);
    }

    step() {
        if (this.halted) return null;
        if (this.pc >= this.memory.length) {
            this.fault('BOUNDS', `PC=${this.pc} out of memory`);
            return null;
        }

        const instrWord = this.memory[this.pc];
        if (instrWord === 0) {
            this.halted = true;
            this.running = false;
            this.output += `[HALT] Zero instruction at PC=${this.pc}\n`;
            this.emit('halt', { pc: this.pc });
            return null;
        }

        const d = this.decodeInstruction(instrWord);
        this.stepCount++;

        if (!this.checkCondition(d.cond)) {
            const result = {
                pc: this.pc,
                instr: d,
                skipped: true,
                desc: `${this.opName(d.opcode)}${this.condName(d.cond)} skipped (condition false)`,
            };
            this.pc++;
            this.emit('step', result);
            this.emit('stateChange', this.getState());
            return result;
        }

        let result = null;
        switch (d.opcode) {
            case 0: result = this._execLoad(d); break;
            case 1: result = this._execSave(d); break;
            case 2: result = this._execCall(d); break;
            case 3: result = this._execReturn(d); break;
            case 4: result = this._execChange(d); break;
            case 5: result = this._execSwitch(d); break;
            case 6: result = this._execTperm(d); break;
            case 7: result = this._execLambda(d); break;
            case 8: result = this._execEloadcall(d); break;
            case 9: result = this._execXloadlambda(d); break;
            case 10: result = this._execDread(d); break;
            case 11: result = this._execDwrite(d); break;
            case 12: result = this._execBfext(d); break;
            case 13: result = this._execBfins(d); break;
            case 14: result = this._execMcmp(d); break;
            case 15: result = this._execIadd(d); break;
            case 16: result = this._execIsub(d); break;
            case 17: result = this._execBranch(d); break;
            case 18: result = this._execShl(d); break;
            case 19: result = this._execShr(d); break;
            default:
                this.fault('INVALID_OP', `Unknown opcode ${d.opcode}`);
                return null;
        }

        if (result) {
            this.dr[0] = 0;
            this.emit('step', result);
            this.emit('stateChange', this.getState());
        }
        return result;
    }

    _execLoad(d) {
        const clistGT = this.cr[d.crSrc].word0;
        if (clistGT === 0) {
            this.fault('NULL_CAP', `LOAD: CR${d.crSrc} is NULL`);
            return null;
        }
        const check = this.mLoad(clistGT, 'L');
        if (!check.ok) {
            this.fault(check.fault, `LOAD: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const targetIdx = d.imm;
        if (targetIdx >= this.nsCount || !this.isNSEntryValid(targetIdx)) {
            this.fault('BOUNDS', `LOAD: namespace index ${targetIdx} out of bounds`);
            return null;
        }
        const entry = this.readNSEntry(targetIdx);
        if (!entry) {
            this.fault('BOUNDS', `LOAD: entry ${targetIdx} is null`);
            return null;
        }
        if (!this.validateMAC(entry)) {
            this.fault('SEAL', `LOAD: entry ${targetIdx} seal failed`);
            return null;
        }
        const gt = this.memory[entry.word0_location] || 0;
        if (!this._writeCR(d.crDst, gt, entry)) return null;
        const label = this.nsLabels[targetIdx] || 'entry_'+targetIdx;
        const desc = `LOAD CR${d.crDst}, [CR${d.crSrc} + ${targetIdx}] → ${label}`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._loadPipeline(d, label) };
    }

    _execSave(d) {
        const srcGT = this.cr[d.crDst].word0;
        if (srcGT === 0) {
            this.fault('NULL_CAP', `SAVE: CR${d.crDst} is NULL`);
            return null;
        }
        const srcParsed = this.parseGT(srcGT);
        const srcEntry = this.readNSEntry(srcParsed.index);
        if (srcEntry) {
            const srcWord1 = this.parseNSWord1(srcEntry.word1_limit);
            if (srcWord1.b !== 1 && !this.mElevation) {
                this.fault('BIND', `SAVE: CR${d.crDst} GT has B=0 — not bindable to c-list`);
                return null;
            }
        }
        const clistGT = this.cr[d.crSrc].word0;
        if (clistGT === 0) {
            this.fault('NULL_CAP', `SAVE: CR${d.crSrc} C-List is NULL`);
            return null;
        }
        const clistCheck = this.mLoad(clistGT, 'S');
        if (!clistCheck.ok) {
            this.fault(clistCheck.fault, `SAVE: CR${d.crSrc}: ${clistCheck.message}`);
            return null;
        }
        const targetIdx = d.imm;
        if (!this.isNSEntryValid(targetIdx)) {
            const parsed = this.parseGT(srcGT);
            const loc = targetIdx * this.SLOT_SIZE;
            const lim17 = 0xFF;
            this.writeNSEntry(targetIdx, loc, lim17, 0, 0, 0, 0, parsed.type, 0);
            this.nsLabels[targetIdx] = `dyn_${targetIdx}`;
        }
        const clistParsed = this.parseGT(clistGT);
        const clistIdx = clistParsed.index;
        if (!this.nsClistMap[clistIdx]) {
            this.nsClistMap[clistIdx] = [];
        }
        if (!this.nsClistMap[clistIdx].includes(targetIdx)) {
            this.nsClistMap[clistIdx].push(targetIdx);
        }
        const entry = this.readNSEntry(targetIdx);
        const saveLoc = entry.word0_location;
        this.memory[saveLoc] = srcGT;
        const desc = `SAVE CR${d.crDst} → [CR${d.crSrc} + ${targetIdx}]`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc };
    }

    _execCall(d) {
        const targetGT = this.cr[d.crDst].word0;
        if (targetGT === 0) {
            this.fault('NULL_CAP', `CALL: CR${d.crDst} is NULL`);
            return null;
        }
        const check = this.mLoad(targetGT, 'E');
        if (!check.ok) {
            this.fault(check.fault, `CALL: CR${d.crDst}: ${check.message}`);
            return null;
        }

        const handler = this.nsHandlers[check.index];
        if (handler) {
            return this._dispatchHandler(d, check, handler);
        }

        this.callStack.push({
            returnPC: this.pc + 1,
            savedCRs: this.cr.map(c => ({...c})),
            savedDRs: [...this.dr],
            savedFlags: {...this.flags},
        });

        const label = this.nsLabels[check.index] || 'abstraction';
        const desc = `CALL CR${d.crDst} → ${label}`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._callPipeline(d, label) };
    }

    _dispatchHandler(d, check, handler) {
        const label = this.nsLabels[check.index] || 'handler';
        switch (handler) {
            case 'gc': {
                const desc = `CALL CR${d.crDst} → ${label} [safe Turing abstraction: GC]`;
                this.output += desc + '\n';
                this.output += `[M] Entering atomic Turing abstraction: ${label}\n`;
                this.mElevation = true;
                const gcResult = this.runGC();
                this.mElevation = false;
                this.output += `[M] Exiting atomic Turing abstraction: ${label} — RETURN\n`;
                this.pc++;
                return { pc: this.pc - 1, instr: d, desc, pipeline: [
                    { stage: 'CALL', desc: `Enter ${label} safe abstraction`, perm: 'E', status: 'pass' },
                    { stage: 'GC-SCAN', desc: `Scan CRs, confirm ${gcResult.liveCount} live entries`, status: 'pass' },
                    { stage: 'GC-SWEEP', desc: `Sweep ${gcResult.freedSlots} garbage entries`, status: 'pass' },
                    { stage: 'RETURN', desc: `Exit ${label}, flip polarity`, status: 'pass' },
                ]};
            }
            default:
                this.fault('HANDLER', `Unknown handler: ${handler}`);
                return null;
        }
    }

    _execReturn(d) {
        if (this.callStack.length === 0) {
            this.halted = true;
            this.running = false;
            this.output += `RETURN: call stack empty — halt\n`;
            this.emit('halt', { pc: this.pc });
            return { pc: this.pc, instr: d, desc: 'RETURN (halt — empty stack)' };
        }
        const frame = this.callStack.pop();
        const desc = `RETURN CR${d.crDst} → PC=${frame.returnPC}`;
        this.output += desc + '\n';
        this.pc = frame.returnPC;
        return { pc: frame.returnPC, instr: d, desc, pipeline: this._returnPipeline(d, frame) };
    }

    _execChange(d) {
        const srcGT = this.cr[d.crSrc].word0;
        if (srcGT === 0) {
            this.fault('NULL_CAP', `CHANGE: CR${d.crSrc} is NULL`);
            return null;
        }
        const targetIdx = d.imm;
        if (targetIdx >= this.nsCount || !this.isNSEntryValid(targetIdx)) {
            this.fault('BOUNDS', `CHANGE: index ${targetIdx} out of bounds`);
            return null;
        }
        const entry = this.readNSEntry(targetIdx);
        if (!entry) {
            this.fault('BOUNDS', `CHANGE: entry ${targetIdx} is null`);
            return null;
        }
        const gt = this.memory[entry.word0_location] || 0;
        if (!this._writeCR(d.crDst, gt, entry)) return null;
        const desc = `CHANGE CR${d.crDst}, [CR${d.crSrc}] idx=${targetIdx}`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc };
    }

    _execSwitch(d) {
        const srcGT = this.cr[d.crSrc].word0;
        const target = d.imm & 0x7;
        if (srcGT === 0) {
            this.fault('NULL_CAP', `SWITCH: CR${d.crSrc} is NULL`);
            return null;
        }
        const temp = { ...this.cr[d.crSrc] };
        this.cr[d.crSrc] = { ...this.cr[target] };
        this.cr[target] = temp;
        const desc = `SWITCH CR${d.crSrc} ↔ CR${target}`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc };
    }

    _execTperm(d) {
        const gt = this.cr[d.crDst].word0;
        const presetCode = d.imm & 0xF;

        const presetMasks = [
            [],                ['R'],           ['R','W'],       ['X'],
            ['R','X'],         ['R','W','X'],   ['L'],           ['S'],
            ['E'],             ['L','S'],       ['L','E'],       ['S','E'],
            ['L','S','E'],     null,            null,            null,
        ];

        if (presetMasks[presetCode] === null) {
            this.fault('TPERM_RSV', `TPERM: reserved preset code ${presetCode}`);
            return null;
        }

        if (gt === 0) {
            this.flags.Z = false;
            this.flags.N = true;
            this.flags.C = false;
            this.flags.V = false;
            const desc = `TPERM CR${d.crDst} [NULL] — Z=0`;
            this.output += desc + '\n';
            this.pc++;
            return { pc: this.pc - 1, instr: d, desc };
        }

        const parsed = this.parseGT(gt);
        const required = presetMasks[presetCode];
        const hasAll = required.every(p => parsed.permissions[p] === 1);

        this.flags.Z = hasAll;
        this.flags.N = !hasAll;
        this.flags.C = false;
        this.flags.V = false;

        const permStr = required.join('') || 'CLEAR';
        const result = hasAll ? 'PASS' : 'FAIL';
        const desc = `TPERM CR${d.crDst}, ${permStr} → ${result} (Z=${hasAll ? 1 : 0})`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._tpermPipeline(d, parsed, hasAll) };
    }

    _execLambda(d) {
        const crIdx = d.crDst;
        const targetGT = this.cr[crIdx].word0;
        if (targetGT === 0) {
            this.fault('NULL_CAP', `LAMBDA: CR${crIdx} is NULL`);
            return null;
        }
        const check = this.mLoad(targetGT, 'X');
        if (!check.ok) {
            this.fault(check.fault, `LAMBDA: CR${crIdx}: ${check.message}`);
            return null;
        }

        const label = this.nsLabels[check.index] || 'reduction';
        const desc = `LAMBDA CR${crIdx} → ${label}`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._lambdaPipeline(d, label) };
    }

    _execEloadcall(d) {
        const clistGT = this.cr[d.crSrc].word0;
        if (clistGT === 0) {
            this.fault('NULL_CAP', `ELOADCALL: CR${d.crSrc} C-List is NULL`);
            return null;
        }
        const loadCheck = this.mLoad(clistGT, 'L');
        if (!loadCheck.ok) {
            this.fault(loadCheck.fault, `ELOADCALL LOAD: CR${d.crSrc}: ${loadCheck.message}`);
            return null;
        }

        const targetIdx = d.imm;
        if (targetIdx >= this.nsCount || !this.isNSEntryValid(targetIdx)) {
            this.fault('BOUNDS', `ELOADCALL: namespace index ${targetIdx} out of bounds`);
            return null;
        }
        const entry = this.readNSEntry(targetIdx);
        if (!entry) {
            this.fault('BOUNDS', `ELOADCALL: entry ${targetIdx} is null`);
            return null;
        }
        if (!this.validateMAC(entry)) {
            this.fault('SEAL', `ELOADCALL: entry ${targetIdx} seal failed`);
            return null;
        }

        const gt = this.memory[entry.word0_location] || 0;
        if (!this._writeCR(d.crDst, gt, entry)) return null;

        const tpermCheck = this.mLoad(gt, 'E');
        if (!tpermCheck.ok) {
            this.fault(tpermCheck.fault, `ELOADCALL TPERM: CR${d.crDst}: ${tpermCheck.message}`);
            return null;
        }

        this.callStack.push({
            returnPC: this.pc + 1,
            savedCRs: this.cr.map(c => ({...c})),
            savedDRs: [...this.dr],
            savedFlags: {...this.flags},
        });

        const label = this.nsLabels[targetIdx] || 'abstraction';
        const desc = `ELOADCALL CR${d.crDst}, [CR${d.crSrc} + ${targetIdx}] → ${label} (LOAD+TPERM+CALL)`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._eloadcallPipeline(d, label) };
    }

    _execXloadlambda(d) {
        const clistGT = this.cr[d.crSrc].word0;
        if (clistGT === 0) {
            this.fault('NULL_CAP', `XLOADLAMBDA: CR${d.crSrc} C-List is NULL`);
            return null;
        }
        const loadCheck = this.mLoad(clistGT, 'L');
        if (!loadCheck.ok) {
            this.fault(loadCheck.fault, `XLOADLAMBDA LOAD: CR${d.crSrc}: ${loadCheck.message}`);
            return null;
        }

        const slotIdx = d.imm;
        if (slotIdx >= this.nsCount || !this.isNSEntryValid(slotIdx)) {
            this.fault('BOUNDS', `XLOADLAMBDA: slot ${slotIdx} out of bounds`);
            return null;
        }
        const entry = this.readNSEntry(slotIdx);
        if (!entry) {
            this.fault('BOUNDS', `XLOADLAMBDA: slot ${slotIdx} is null`);
            return null;
        }
        if (!this.validateMAC(entry)) {
            this.fault('SEAL', `XLOADLAMBDA: slot ${slotIdx} seal failed`);
            return null;
        }

        const gt = this.memory[entry.word0_location] || 0;
        if (!this._writeCR(d.crDst, gt, entry)) return null;

        const parsed = this.parseGT(gt);
        if (!parsed.permissions.X) {
            this.fault('PERMISSION', `XLOADLAMBDA TPERM: CR${d.crDst} lacks X permission`);
            return null;
        }

        const label = this.nsLabels[slotIdx] || 'slot';
        const desc = `XLOADLAMBDA CR${d.crDst}, [CR${d.crSrc} + ${slotIdx}] → ${label} (LOAD+TPERM+LAMBDA)`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._xloadlambdaPipeline(d, label) };
    }

    _execDread(d) {
        const drIdx = d.crDst;
        const dataGT = this.cr[d.crSrc].word0;
        if (dataGT === 0) {
            this.fault('NULL_CAP', `DREAD: CR${d.crSrc} is NULL`);
            return null;
        }
        const check = this.mLoad(dataGT, 'R');
        if (!check.ok) {
            this.fault(check.fault, `DREAD: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const entry = check.entry;
        const loc = entry.word0_location;
        const lim = this.parseNSWord1(entry.word1_limit);
        const offset = d.imm;
        if (offset > lim.limit) {
            this.fault('BOUNDS', `DREAD: offset ${offset} exceeds DATA limit ${lim.limit}`);
            return null;
        }
        const value = this.memory[loc + offset];
        this.dr[drIdx] = value >>> 0;
        const label = this.nsLabels[check.index] || 'data';
        const desc = `DREAD DR${drIdx}, [CR${d.crSrc} + ${offset}] → 0x${(value >>> 0).toString(16).toUpperCase().padStart(8,'0')} (${label})`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'DREAD', desc: `Read word ${offset} from ${label} into DR${drIdx}`, perm: 'R', status: 'pass' },
        ]};
    }

    _execDwrite(d) {
        const drIdx = d.crDst;
        const dataGT = this.cr[d.crSrc].word0;
        if (dataGT === 0) {
            this.fault('NULL_CAP', `DWRITE: CR${d.crSrc} is NULL`);
            return null;
        }
        const check = this.mLoad(dataGT, 'W');
        if (!check.ok) {
            this.fault(check.fault, `DWRITE: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const entry = check.entry;
        const loc = entry.word0_location;
        const lim = this.parseNSWord1(entry.word1_limit);
        const offset = d.imm;
        if (offset > lim.limit) {
            this.fault('BOUNDS', `DWRITE: offset ${offset} exceeds DATA limit ${lim.limit}`);
            return null;
        }
        const value = this.dr[drIdx] >>> 0;
        this.memory[loc + offset] = value;
        const label = this.nsLabels[check.index] || 'data';
        const desc = `DWRITE DR${drIdx}, [CR${d.crSrc} + ${offset}] ← 0x${value.toString(16).toUpperCase().padStart(8,'0')} (${label})`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'DWRITE', desc: `Write DR${drIdx} to word ${offset} of ${label}`, perm: 'W', status: 'pass' },
        ]};
    }

    _setFlags(result) {
        result = result >>> 0;
        this.flags.Z = (result === 0);
        this.flags.N = ((result >>> 31) & 1) === 1;
    }

    _setAddFlags(a, b, result) {
        const r = result >>> 0;
        this.flags.Z = (r === 0);
        this.flags.N = ((r >>> 31) & 1) === 1;
        this.flags.C = (result > 0xFFFFFFFF);
        const sa = (a >>> 31) & 1;
        const sb = (b >>> 31) & 1;
        const sr = (r >>> 31) & 1;
        this.flags.V = ((sa === sb) && (sr !== sa));
    }

    _setSubFlags(a, b, result) {
        const r = result >>> 0;
        this.flags.Z = (r === 0);
        this.flags.N = ((r >>> 31) & 1) === 1;
        this.flags.C = (a >= b);
        const sa = (a >>> 31) & 1;
        const sb = (b >>> 31) & 1;
        const sr = (r >>> 31) & 1;
        this.flags.V = ((sa !== sb) && (sr !== sa));
    }

    _execBfext(d) {
        const dataGT = this.cr[d.crSrc].word0;
        if (dataGT === 0) {
            this.fault('NULL_CAP', `BFEXT: CR${d.crSrc} is NULL`);
            return null;
        }
        const check = this.mLoad(dataGT, 'R');
        if (!check.ok) {
            this.fault(check.fault, `BFEXT: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const entry = check.entry;
        const loc = entry.word0_location;
        const pos = (d.imm >>> 5) & 0x1F;
        const width = d.imm & 0x1F;
        if (width === 0 || pos + width > 32) {
            this.fault('BOUNDS', `BFEXT: invalid bitfield pos=${pos} width=${width}`);
            return null;
        }
        const word = this.memory[loc] >>> 0;
        const mask = ((1 << width) - 1) >>> 0;
        const value = (word >>> pos) & mask;
        const drIdx = d.crDst;
        this.dr[drIdx] = value >>> 0;
        const label = this.nsLabels[check.index] || 'data';
        const desc = `BFEXT DR${drIdx}, [CR${d.crSrc}], pos=${pos}, w=${width} → 0x${value.toString(16).toUpperCase()} (${label})`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'BFEXT', desc: `Extract bits [${pos}:${pos+width-1}] from ${label} into DR${drIdx}`, perm: 'R', status: 'pass' },
        ]};
    }

    _execBfins(d) {
        const dataGT = this.cr[d.crSrc].word0;
        if (dataGT === 0) {
            this.fault('NULL_CAP', `BFINS: CR${d.crSrc} is NULL`);
            return null;
        }
        const check = this.mLoad(dataGT, 'W');
        if (!check.ok) {
            this.fault(check.fault, `BFINS: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const entry = check.entry;
        const loc = entry.word0_location;
        const pos = (d.imm >>> 5) & 0x1F;
        const width = d.imm & 0x1F;
        if (width === 0 || pos + width > 32) {
            this.fault('BOUNDS', `BFINS: invalid bitfield pos=${pos} width=${width}`);
            return null;
        }
        const drIdx = d.crDst;
        const insertVal = this.dr[drIdx] >>> 0;
        const mask = (((1 << width) - 1) << pos) >>> 0;
        const oldWord = this.memory[loc] >>> 0;
        const newWord = ((oldWord & ~mask) | ((insertVal << pos) & mask)) >>> 0;
        this.memory[loc] = newWord;
        const label = this.nsLabels[check.index] || 'data';
        const desc = `BFINS DR${drIdx}, [CR${d.crSrc}], pos=${pos}, w=${width} ← 0x${(insertVal & ((1 << width) - 1)).toString(16).toUpperCase()} (${label})`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'BFINS', desc: `Insert bits [${pos}:${pos+width-1}] from DR${drIdx} into ${label}`, perm: 'W', status: 'pass' },
        ]};
    }

    _execMcmp(d) {
        const a = this.dr[d.crDst] >>> 0;
        const b = this.dr[d.crSrc] >>> 0;
        this._setSubFlags(a, b, a - b);
        const desc = `MCMP DR${d.crDst}, DR${d.crSrc} → ${a} vs ${b} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=${this.flags.C?1:0} V=${this.flags.V?1:0}]`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'MCMP', desc: `Compare DR${d.crDst}(${a}) with DR${d.crSrc}(${b})`, status: 'pass' },
        ]};
    }

    _execIadd(d) {
        const drA = d.crSrc;
        const drB = d.imm & 0xF;
        const a = this.dr[drA] >>> 0;
        const b = this.dr[drB] >>> 0;
        const result = a + b;
        this._setAddFlags(a, b, result);
        this.dr[d.crDst] = result >>> 0;
        const desc = `IADD DR${d.crDst}, DR${drA}, DR${drB} → ${a} + ${b} = ${result >>> 0} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=${this.flags.C?1:0} V=${this.flags.V?1:0}]`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'IADD', desc: `DR${d.crDst} = DR${drA} + DR${drB}`, status: 'pass' },
        ]};
    }

    _execIsub(d) {
        const drA = d.crSrc;
        const drB = d.imm & 0xF;
        const a = this.dr[drA] >>> 0;
        const b = this.dr[drB] >>> 0;
        const result = a - b;
        this._setSubFlags(a, b, result);
        this.dr[d.crDst] = result >>> 0;
        const desc = `ISUB DR${d.crDst}, DR${drA}, DR${drB} → ${a} - ${b} = ${result >>> 0} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=${this.flags.C?1:0} V=${this.flags.V?1:0}]`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'ISUB', desc: `DR${d.crDst} = DR${drA} - DR${drB}`, status: 'pass' },
        ]};
    }

    _execBranch(d) {
        const soff = (d.imm & 0x4000) ? (d.imm | 0xFFFF8000) : d.imm;
        const target = this.pc + soff;
        if (target < 0 || target >= this.memory.length) {
            this.fault('BOUNDS', `BRANCH: target PC=${target} out of range`);
            return null;
        }
        const desc = `BRANCH ${soff >= 0 ? '+' : ''}${soff} → PC=${target}`;
        this.output += desc + '\n';
        this.pc = target;
        return { pc: this.pc - soff, instr: d, desc, pipeline: [
            { stage: 'BRANCH', desc: `Branch to PC=${target} (offset ${soff})`, status: 'pass' },
        ]};
    }

    _execShl(d) {
        const drSrc = d.crSrc;
        const shamt = d.imm & 0x1F;
        const value = this.dr[drSrc] >>> 0;
        const lastBitOut = shamt > 0 ? ((value >>> (32 - shamt)) & 1) : 0;
        const result = (value << shamt) >>> 0;
        this.flags.Z = (result === 0);
        this.flags.N = ((result >>> 31) & 1) === 1;
        this.flags.C = lastBitOut === 1;
        this.flags.V = false;
        this.dr[d.crDst] = result;
        const desc = `SHL DR${d.crDst}, DR${drSrc}, ${shamt} → 0x${result.toString(16).toUpperCase().padStart(8,'0')} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=${this.flags.C?1:0}]`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'SHL', desc: `DR${d.crDst} = DR${drSrc} << ${shamt}`, status: 'pass' },
        ]};
    }

    _execShr(d) {
        const drSrc = d.crSrc;
        const shamt = d.imm & 0x1F;
        const arith = (d.imm >>> 5) & 1;
        const value = this.dr[drSrc] >>> 0;
        const lastBitOut = shamt > 0 ? ((value >>> (shamt - 1)) & 1) : 0;
        let result;
        if (arith) {
            result = (value | 0) >> shamt;
            result = result >>> 0;
        } else {
            result = value >>> shamt;
        }
        this.flags.Z = (result === 0);
        this.flags.N = ((result >>> 31) & 1) === 1;
        this.flags.C = lastBitOut === 1;
        this.flags.V = false;
        this.dr[d.crDst] = result;
        const shType = arith ? 'ASR' : 'LSR';
        const desc = `SHR DR${d.crDst}, DR${drSrc}, ${shamt} ${shType} → 0x${result.toString(16).toUpperCase().padStart(8,'0')} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=${this.flags.C?1:0}]`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'SHR', desc: `DR${d.crDst} = DR${drSrc} ${shType} ${shamt}`, status: 'pass' },
        ]};
    }

    _eloadcallPipeline(d, label) {
        return [
            { stage: 'LOAD', desc: `Namespace lookup via CR${d.crSrc}, index ${d.imm}`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify E permission on ${label}`, perm: 'E', status: 'pass' },
            { stage: 'CALL', desc: `Enter ${label}, save context`, status: 'pass' },
        ];
    }

    _xloadlambdaPipeline(d, label) {
        return [
            { stage: 'LOAD', desc: `C-List slot lookup [CR${d.crSrc} + ${d.imm}]`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify X permission on ${label}`, perm: 'X', status: 'pass' },
            { stage: 'LAMBDA', desc: `Church reduction via ${label}`, status: 'pass' },
        ];
    }

    _loadPipeline(d, label) {
        return [
            { stage: 'LOAD', desc: `Namespace lookup via CR${d.crSrc}`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify L permission on CR${d.crSrc}`, perm: 'L', status: 'pass' },
            { stage: 'VALIDATE', desc: `FNV seal check on entry ${d.imm}`, status: 'pass' },
            { stage: 'WRITE', desc: `Write ${label} to CR${d.crDst}`, status: 'pass' },
        ];
    }

    _callPipeline(d, label) {
        return [
            { stage: 'LOAD', desc: `Read target GT from CR${d.crDst}`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify E permission on target`, perm: 'E', status: 'pass' },
            { stage: 'CALL', desc: `Enter ${label}, save context`, status: 'pass' },
        ];
    }

    _returnPipeline(d, frame) {
        return [
            { stage: 'RETURN', desc: `Restore context, PC → ${frame.returnPC}`, status: 'pass' },
        ];
    }

    _tpermPipeline(d, parsed, hasAll) {
        const permBits = [];
        for (const p of ['R','W','X','L','S','E']) {
            if (parsed.permissions[p]) permBits.push(p);
        }
        return [
            { stage: 'TPERM', desc: `Check permissions [${permBits.join(',')}] → ${hasAll ? 'PASS' : 'FAIL'}`, status: hasAll ? 'pass' : 'fail' },
        ];
    }

    _lambdaPipeline(d, label) {
        return [
            { stage: 'LOAD', desc: `Read CR${d.crDst} GT`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify X permission`, perm: 'X', status: 'pass' },
            { stage: 'LAMBDA', desc: `Church reduction via ${label}`, status: 'pass' },
        ];
    }

    loadProgram(words, startAddr) {
        startAddr = startAddr || 0;
        for (let i = 0; i < words.length; i++) {
            if (startAddr + i < this.memory.length) {
                this.memory[startAddr + i] = words[i] >>> 0;
            }
        }
        this.pc = startAddr;
        this.halted = false;
        this.running = false;
        this.output = '';
        this.faultLog = [];
        this.stepCount = 0;
        this.callStack = [];
        this.emit('programLoaded', { addr: startAddr, length: words.length });
        this.emit('stateChange', this.getState());
    }

    run(maxSteps) {
        maxSteps = maxSteps || 10000;
        this.running = true;
        let steps = 0;
        while (this.running && !this.halted && steps < maxSteps) {
            const result = this.step();
            if (!result) break;
            steps++;
        }
        this.running = false;
        return steps;
    }

    getState() {
        return {
            cr: this.cr.map(c => ({...c})),
            dr: [...this.dr],
            pc: this.pc,
            flags: {...this.flags},
            callStack: this.callStack.length,
            stepCount: this.stepCount,
            halted: this.halted,
            output: this.output,
            namespaceTable: this.namespaceTable,
        };
    }

    getFormattedCR(idx) {
        const cr = this.cr[idx];
        const isEmpty = !cr || (cr.word0 === 0 && cr.word1 === 0 && cr.word2 === 0 && cr.word3 === 0 && cr.m === 0);
        if (isEmpty) {
            return {
                index: idx, isNull: true, mBit: 0,
                word0_gt: '00000000', perms: '------', gtVersion: 0, gtIndex: 0, gtType: 'NULL', gtTypeName: 'NULL',
                word1_location: 0,
                word2_limit_raw: 0, limitB: 0, limitF: 0, limit17: 0,
                word3_seals_raw: 0, sealVersion: 0, sealFNV: 0,
            };
        }
        const parsed = this.parseGT(cr.word0);
        const lim = this.parseNSWord1(cr.word2);
        const sealVer = (cr.word3 >>> 25) & 0x7F;
        const sealFNV = cr.word3 & 0x01FFFFFF;
        const permStr = (parsed.permissions.R ? 'R' : '-') +
                        (parsed.permissions.W ? 'W' : '-') +
                        (parsed.permissions.X ? 'X' : '-') +
                        (parsed.permissions.L ? 'L' : '-') +
                        (parsed.permissions.S ? 'S' : '-') +
                        (parsed.permissions.E ? 'E' : '-');
        return {
            index: idx, isNull: false, mBit: cr.m || 0,
            word0_gt: cr.word0.toString(16).toUpperCase().padStart(8, '0'),
            perms: permStr,
            gtVersion: parsed.version,
            gtIndex: parsed.index,
            gtType: parsed.type,
            gtTypeName: parsed.typeName,
            word1_location: cr.word1,
            word2_limit_raw: cr.word2,
            limitB: lim.b,
            limitF: lim.f,
            limit17: lim.limit,
            word3_seals_raw: cr.word3,
            sealVersion: sealVer,
            sealFNV: sealFNV,
        };
    }

    saveToNamespace(label, words, perms, gtType) {
        perms = perms || {R:0,W:0,X:1,L:0,S:0,E:0};
        gtType = gtType || 0;
        let idx = -1;
        for (let i = 0; i < this.nsCount; i++) {
            if (this.nsLabels[i] === label) { idx = i; break; }
        }
        if (idx === -1) {
            idx = this.nsCount;
        }
        const loc = idx * this.SLOT_SIZE;
        const codeLen = words.length;
        const totalLen = 1 + codeLen;
        const lim17 = Math.min(totalLen - 1, 0x1FFFF);
        const gtWord = this.createGT(0, idx, perms, gtType);
        this.writeNSEntry(idx, loc, lim17, 0, 0, 0, 0, gtType, 0);
        this.nsLabels[idx] = label;
        this.memory[loc] = gtWord;
        for (let i = 0; i < codeLen; i++) {
            this.memory[loc + 1 + i] = words[i] >>> 0;
        }
        this.emit('stateChange', this.getState());
        return idx;
    }

    saveToNamespaceAt(idx, label, words, perms, gtType) {
        perms = perms || {R:0,W:0,X:1,L:0,S:0,E:0};
        gtType = gtType || 0;
        const loc = idx * this.SLOT_SIZE;
        const codeLen = words.length;
        const totalLen = 1 + codeLen;
        const lim17 = Math.min(totalLen - 1, 0x1FFFF);
        const gtWord = this.createGT(0, idx, perms, gtType);
        for (let j = 0; j < this.SLOT_SIZE; j++) {
            if (loc + j < this.memory.length) this.memory[loc + j] = 0;
        }
        this.writeNSEntry(idx, loc, lim17, 0, 0, 0, 0, gtType, 0);
        this.nsLabels[idx] = label;
        this.memory[loc] = gtWord;
        for (let i = 0; i < codeLen; i++) {
            this.memory[loc + 1 + i] = words[i] >>> 0;
        }
        this.emit('stateChange', this.getState());
        return idx;
    }

    getEntryMemory(idx) {
        const entry = this.readNSEntry(idx);
        if (!entry) return null;
        const loc = entry.word0_location;
        const lim = this.parseNSWord1(entry.word1_limit);
        const gt = this.memory[loc];
        const codeWords = [];
        for (let i = 1; i <= lim.limit; i++) {
            codeWords.push(this.memory[loc + i]);
        }
        return { label: entry.label, location: loc, limit: lim.limit, gt: gt, words: codeWords, codeLength: codeWords.length };
    }

    setEntryMemory(idx, dataWords) {
        const entry = this.readNSEntry(idx);
        if (!entry) return false;
        const loc = entry.word0_location;
        const lim17 = Math.min(dataWords.length - 1, 0x1FFFF);
        const parsed = this.parseNSWord1(entry.word1_limit);
        this.writeNSEntry(idx, loc, lim17, parsed.b, parsed.f, parsed.g, parsed.chainable, parsed.gtType, (entry.word2_seals >>> 25) & 0x7F);
        for (let i = 0; i < dataWords.length; i++) {
            this.memory[loc + i] = dataWords[i] >>> 0;
        }
        this.emit('stateChange', this.getState());
        return true;
    }

    getNSTableMemoryDump() {
        const dump = [];
        for (let i = 0; i < this.nsCount; i++) {
            const base = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS;
            dump.push({
                index: i,
                label: this.nsLabels[i] || '',
                raw: [this.memory[base], this.memory[base + 1], this.memory[base + 2]],
            });
        }
        return dump;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChurchSimulator;
}
