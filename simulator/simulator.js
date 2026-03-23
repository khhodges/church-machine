class ChurchSimulator {
    constructor() {
        this._listeners = {};
        this.NS_TABLE_BASE = 0xFD00;
        this.NS_ENTRY_WORDS = 3;
        this.MAX_NS_ENTRIES = 256;
        this.SLOT_SIZE = 0x100;

        this.abstractionRegistry = null;
        this.systemAbstractions = null;
        this.deviceAbstractions = null;

        this.reset();
    }

    initAbstractions(registry, systemAbs, deviceAbs) {
        this.abstractionRegistry = registry;
        this.systemAbstractions = systemAbs;
        this.deviceAbstractions = deviceAbs;
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
        this.sto = 0;
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
        this.ledBits = 0;
        this.ledMode = 'boot';
        this.lastCapability = null;
        this.auditLog = [];

        this._initNamespaceTable();
        this.output += '--- HARD RESET: all registers zeroed ---\n';
        this.output += 'Boot microcode ready. Step or Run to begin boot sequence.\n';
        this.emit('reset', {});
        this.emit('stateChange', this.getState());
    }

    _returnToBoot() {
        for (let i = 0; i < 16; i++) {
            this._clearCR(i);
        }
        this.dr.fill(0);
        this.flags = { N: false, Z: false, C: false, V: false };
        this.sto = 0;
        this.callStack = [];
        this.lambdaActive = false;
        this.lambdaReturnPC = 0;
        this.pc = 0;
        this.halted = false;
        this.running = false;
        this.bootComplete = false;
        this.mElevation = false;
        this.bootStep = 0;
        this.ledBits = 0;
        this.ledMode = 'boot';
        this.output += '[PP250] Machine state cleared. Re-entering boot sequence.\n';
        this.emit('stateChange', this.getState());
    }

    packNSWord1(limit17, bFlag, fFlag, gBit, chainable, gtType, clistCount) {
        return (
            ((bFlag & 1) << 31) |
            ((fFlag & 1) << 30) |
            ((gBit & 1) << 29) |
            ((chainable & 1) << 28) |
            ((gtType & 3) << 26) |
            (((clistCount || 0) & 0x1FF) << 17) |
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
            clistCount: (word1 >>> 17) & 0x1FF,
            limit: word1 & 0x1FFFF,
        };
    }

    packLimitWord(limit17, bFlag, fFlag) {
        return this.packNSWord1(limit17, bFlag, fFlag, 0, 0, 0, 0);
    }

    parseLimitWord(word1) {
        return this.parseNSWord1(word1);
    }

    writeNSEntry(idx, location, limit17, bFlag, fFlag, gBit, chainable, gtType, version, clistCount) {
        const base = this.NS_TABLE_BASE + idx * this.NS_ENTRY_WORDS;
        this.memory[base + 0] = location >>> 0;
        this.memory[base + 1] = this.packNSWord1(limit17, bFlag, fFlag, gBit, chainable, gtType, clistCount || 0);
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
            clistCount: parsed.clistCount,
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

    _getAbstractionCatalog() {
        if (this.abstractionRegistry) {
            const all = this.abstractionRegistry.getAllAbstractions();
            return all.map(a => ({
                label: a.name,
                perms: a.perms,
                chainable: a.chainable || false,
                handler: a.handler || null,
            }));
        }
        return [
            { label: 'Boot.NS',      perms: {R:0,W:0,X:0,L:0,S:0,E:0}, chainable: false },
            { label: 'Boot.Thread',   perms: {R:0,W:0,X:0,L:0,S:0,E:0}, chainable: false },
            { label: 'Boot.Abstr',    perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: '(empty)',       perms: {R:0,W:0,X:0,L:0,S:0,E:0}, chainable: false },
            { label: 'Salvation',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Navana',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Mint',          perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Memory',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Scheduler',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Stack',         perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: true },
            { label: 'DijkstraFlag',  perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'UART',          perms: {R:0,W:0,X:0,L:1,S:1,E:1}, chainable: false },
            { label: 'LED',           perms: {R:0,W:0,X:0,L:1,S:1,E:1}, chainable: false },
            { label: 'Button',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { label: 'Timer',         perms: {R:0,W:0,X:0,L:1,S:1,E:1}, chainable: false },
            { label: 'Display',       perms: {R:0,W:0,X:0,L:1,S:1,E:1}, chainable: false },
            { label: 'SlideRule',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: true },
            { label: 'Abacus',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: true },
            { label: 'Constants',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Circle',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'SUCC',          perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'PRED',          perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'ADD',           perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'SUB',           perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'MUL',           perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'ISZERO',        perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'TRUE',          perms: {R:0,W:0,X:0,L:1,S:0,E:0}, chainable: false },
            { label: 'FALSE',         perms: {R:0,W:0,X:0,L:1,S:0,E:0}, chainable: false },
            { label: 'Family',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Schoolroom',    perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Friends',       perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Tunnel',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Negotiate',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Editor',        perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Assembler',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Debugger',      perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Deployer',      perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { label: 'Browser',       perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { label: 'Messenger',     perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { label: 'Photos',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { label: 'Social',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { label: 'Video',         perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { label: 'Email',         perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { label: 'PAIR',          perms: {R:0,W:0,X:1,L:1,S:0,E:1}, chainable: false },
            { label: 'GC',            perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false, handler: 'gc' },
        ];
    }

    _initNamespaceTable() {
        // GT type semantics: 0=NULL, 1=Real (concrete lump in memory), 2=Abstract (user-uploaded/PassKey), 3=reserved
        // All boot-time slots (Boot.NS, Boot.Thread, Boot.Abstr, Salvation, Navana, Mint, etc.) are Real (type=1)
        // because they reference concrete physical memory lumps in the namespace table.
        // Abstract (type=2) GTs are only created by Navana.Abstraction.Add (user uploads) and Navana.MintPassKey.
        this.nsLabels = {};
        this.nsCount = 0;
        const abstractions = this._getAbstractionCatalog();
        const clistChildren = [];
        const clistGTs = [];

        for (let i = 0; i < abstractions.length; i++) {
            const a = abstractions[i];
            if (i === 3) {
                this.writeNSEntry(i, 0, 0, 0, 0, 0, 0, 0, 0, 0);
                this.nsLabels[i] = a.label;
                clistGTs.push(0);
                clistChildren.push(i);
                continue;
            }
            const loc = (i === 0) ? 0 : i * this.SLOT_SIZE;
            const lim17 = (i === 0) ? (this.memory.length - 1) : (this.SLOT_SIZE - 1);
            const nsTableCount = (i === 0) ? abstractions.length : 0;
            this.writeNSEntry(i, loc, lim17, 0, 0, 0, a.chainable ? 1 : 0, 1, 0, nsTableCount);
            this.nsLabels[i] = a.label;
            if (a.handler) {
                this.nsHandlers[i] = a.handler;
            }
            clistChildren.push(i);
            const gtWord = this.createGT(0, i, a.perms, 1);
            clistGTs.push(gtWord);
        }
        this.nsClistMap[2] = clistChildren;

        const bootAbstrLoc = 2 * this.SLOT_SIZE;
        const bootAllocSize = this.SLOT_SIZE;
        const bootClistCount = clistGTs.length;
        const clistStart = bootAllocSize - bootClistCount;
        for (let i = 0; i < bootClistCount; i++) {
            this.memory[bootAbstrLoc + clistStart + i] = clistGTs[i];
        }
        this.memory[bootAbstrLoc + clistStart] = 0;

        const bootNSBase = this.NS_TABLE_BASE + 2 * this.NS_ENTRY_WORDS;
        const bootW1 = this.packNSWord1(bootAllocSize - 1, 0, 0, 0, 0, 1, bootClistCount);
        this.memory[bootNSBase + 1] = bootW1;
        this.memory[bootNSBase + 2] = this.makeVersionSeals(0, bootAbstrLoc, bootAllocSize - 1);
    }

    _bootStep() {
        // All boot CRs use type=1 (Real) GTs — they reference concrete NS slots with physical lumps.
        // type=2 (Abstract) GTs are only created at runtime by Navana.Abstraction.Add and Navana.MintPassKey.
        if (this.bootComplete) return false;

        switch (this.bootStep) {
            case 0: {
                for (let i = 0; i < 16; i++) {
                    this._clearCR(i);
                }
                this.dr.fill(0);
                this.mElevation = true;
                this.output += '[BOOT] FAULT_RST — All CRs cleared to NULL, all DRs zeroed. M-Elevation ON.\n';
                this.bootStep++;
                this.ledBits = 0b000001; this.ledMode = 'boot';
                break;
            }
            case 1: {
                const gt15 = this.createGT(0, 0, {R:0,W:0,X:0,L:0,S:0,E:0}, 1);
                const check = this.mLoad(gt15, null, undefined);
                if (!check.ok) {
                    this.fault('BOOT', `LOAD_NS mLoad failed: ${check.message}`);
                    return false;
                }
                this._writeCR(15, gt15, check.entry);
                this.output += `[BOOT] LOAD_NS — CR15 <- mLoad(Slot 0) Namespace (base=0x0000, size=${this.memory.length} words, NS table entries=${this.nsCount})\n`;
                this.bootStep++;
                this.ledBits = 0b000011;
                break;
            }
            case 2: {
                const gt12 = this.createGT(0, 1, {R:0,W:0,X:0,L:0,S:0,E:0}, 1);
                const check12 = this.mLoad(gt12, null, undefined);
                if (!check12.ok) {
                    this.fault('BOOT', `INIT_THRD mLoad(Thread) failed: ${check12.message}`);
                    return false;
                }
                this._writeCR(12, gt12, check12.entry);
                this.output += `[BOOT] INIT_THRD — CR12 <- mLoad(Slot 1) Thread identity (zero perms, Real)\n`;
                this.bootStep++;
                this.ledBits = 0b000111;
                break;
            }
            case 3: {
                const gt6 = this.createGT(0, 2, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);
                const check6 = this.mLoad(gt6, null, undefined);
                if (!check6.ok) {
                    this.fault('BOOT', `INIT_ABSTR mLoad(Boot.Abstr) failed: ${check6.message}`);
                    return false;
                }
                this._writeCR(6, gt6, check6.entry);
                this.output += '[BOOT] INIT_ABSTR — CR6 <- mLoad(Slot 2) Boot.Abstr (E, M-elevation)\n';
                this.bootStep++;
                this.ledBits = 0b001111;
                break;
            }
            case 4: {
                const gt2 = this.createGT(0, 2, {R:0,W:0,X:0,L:0,S:0,E:1}, 1);
                const check2 = this.mLoad(gt2, 'E', undefined);
                if (!check2.ok) {
                    this.fault('BOOT', `LOAD_NUC mLoad(Boot.Abstr) failed: ${check2.message}`);
                    return false;
                }
                const abstrEntry = check2.entry;
                const abstrParsed = this.parseNSWord1(abstrEntry.word1_limit);
                if (abstrParsed.f === 1) {
                    this.fault('BOOT', 'LOAD_NUC: Boot.Abstr has F-bit set (Far) — FAULT');
                    return false;
                }
                if (check2.parsed.type !== 1) {
                    this.fault('BOOT', `LOAD_NUC: Boot.Abstr type is ${check2.parsed.typeName}, must be Real`);
                    return false;
                }
                const base = abstrEntry.word0_location;
                const allocSize = abstrParsed.limit + 1;
                const clistCount = abstrParsed.clistCount;
                if (clistCount === 0) {
                    this.fault('BOOT', 'LOAD_NUC: Boot.Abstr has clistCount=0 — no C-List');
                    return false;
                }
                const clistStart = allocSize - clistCount;

                const cr14GT = this.createGT(0, 2, {R:1,W:1,X:1,L:0,S:0,E:0}, 1);
                const cr14Word1 = this.packNSWord1(clistStart - 1, 0, 0, 0, 0, 1, 0);
                this.cr[14] = {
                    word0: cr14GT,
                    word1: base,
                    word2: cr14Word1,
                    word3: abstrEntry.word2_seals,
                    m: this.mElevation ? 1 : 0
                };

                const cr6GT = this.createGT(0, 2, {R:0,W:0,X:0,L:1,S:0,E:0}, 1);
                const cr6Word1 = this.packNSWord1(clistCount - 1, 0, 0, 0, 0, 1, 0);
                this.cr[6] = {
                    word0: cr6GT,
                    word1: (base + clistStart) >>> 0,
                    word2: cr6Word1,
                    word3: abstrEntry.word2_seals,
                    m: this.mElevation ? 1 : 0
                };

                this.pc = 0;
                this.output += `[BOOT] LOAD_NUC — CALL into Boot.Abstr (Slot 2); CR14(code,X,lim=${clistStart-1}), CR6(clist,L,base=0x${(base+clistStart).toString(16).toUpperCase()},lim=${clistCount-1}), PC=0\n`;
                this.bootStep++;
                this.ledBits = 0b011111;
                break;
            }
            case 5:
                this.mElevation = false;
                this.bootComplete = true;
                this.ledBits = 0b111111;
                this.ledMode = 'boot';
                this.output += '[BOOT] COMPLETE — M-Elevation OFF. All Layer 0-1 abstractions initialized. Boot complete.\n';
                break;
        }
        this.emit('stateChange', this.getState());
        return true;
    }

    parseGT(gt32) {
        gt32 = gt32 >>> 0;
        const permBits = (gt32 >>> 25) & 0x7F;
        const type    = (gt32 >>> 23) & 0x3;
        const gt_seq  = (gt32 >>> 16) & 0x7F;
        const index   =  gt32         & 0xFFFF;
        return {
            gt_seq, index,
            permissions: {
                B: (permBits >>> 6) & 1,
                R: (permBits >>> 5) & 1,
                W: (permBits >>> 4) & 1,
                X: (permBits >>> 3) & 1,
                L: (permBits >>> 2) & 1,
                S: (permBits >>> 1) & 1,
                E: (permBits >>> 0) & 1,
            },
            type,
            typeName: ['NULL','Real','Abstract','???'][type & 3],
        };
    }

    createGT(gt_seq, slotId, perms, type) {
        const p = (this.getPermBits(perms) << 25) >>> 0;
        const t = ((type   & 0x3)  << 23) >>> 0;
        const s = ((gt_seq & 0x7F) << 16) >>> 0;
        const i = (slotId  & 0xFFFF)      >>> 0;
        return (p | t | s | i) >>> 0;
    }

    getPermBits(permsObj) {
        let bits = 0;
        if (permsObj.E) bits |= 1;
        if (permsObj.S) bits |= 2;
        if (permsObj.L) bits |= 4;
        if (permsObj.X) bits |= 8;
        if (permsObj.W) bits |= 16;
        if (permsObj.R) bits |= 32;
        if (permsObj.B) bits |= 64;
        return bits & 0x7F;
    }

    computeSeal(location, limit17) {
        let crc = 0xFFFF;
        const update = (byte) => {
            for (let i = 0; i < 8; i++) {
                const bit = ((byte >>> (7 - i)) & 1) ^ ((crc >>> 15) & 1);
                crc = ((crc << 1) & 0xFFFF) ^ (bit ? 0x1021 : 0);
            }
        };
        update((location >>> 24) & 0xFF);
        update((location >>> 16) & 0xFF);
        update((location >>>  8) & 0xFF);
        update( location         & 0xFF);
        update((limit17  >>> 16) & 0xFF);
        update((limit17  >>>  8) & 0xFF);
        update( limit17          & 0xFF);
        return crc & 0xFFFF;
    }

    makeVersionSeals(gt_seq, location, limit17) {
        const seal = this.computeSeal(location, limit17);
        return (((gt_seq & 0x7F) << 25) | (seal & 0xFFFF)) >>> 0;
    }

    validateMAC(entry) {
        if (!entry) return false;
        const storedSeal = entry.word2_seals & 0xFFFF;
        const lim = this.parseNSWord1(entry.word1_limit);
        return storedSeal === this.computeSeal(entry.word0_location, lim.limit);
    }

    _validateClistSlotPerms(parsed, slotIdx) {
        const p = parsed.permissions;
        const permStr = (p.B?'B':'')+(p.R?'R':'')+(p.W?'W':'')+(p.X?'X':'')+(p.L?'L':'')+(p.S?'S':'')+(p.E?'E':'');
        if (slotIdx === 0) {
            const hasX = p.X;
            const onlyXorRX = hasX && !p.W && !p.L && !p.S && !p.E;
            if (!onlyXorRX) {
                return { ok: false, fault: 'DOMAIN_PURITY', message: `CLOOMC slot 0 has ${permStr||'no'} permissions — only X or RX allowed` };
            }
        } else {
            if (p.X && p.E) {
                return { ok: false, fault: 'DOMAIN_PURITY', message: `C-List slot ${slotIdx} has ${permStr} — mixed XE not allowed (use separate slots for X and E)` };
            }
        }
        return { ok: true };
    }

    mLoad(gt32, requiredPerm, srcCRIdx) {
        const parsed = this.parseGT(gt32);
        if (parsed.index >= this.nsCount) {
            return { ok: false, fault: 'BOUNDS', message: `namespace index ${parsed.index} out of bounds` };
        }
        const entry = this.readNSEntry(parsed.index);
        if (!entry) {
            return { ok: false, fault: 'BOUNDS', message: `namespace entry ${parsed.index} is null` };
        }
        const nsGtSeq = (entry.word2_seals >>> 25) & 0x7F;
        const versionMatch = parsed.gt_seq === nsGtSeq;
        const sealValid = this.validateMAC(entry);

        const bBit = parsed.permissions.B || 0;
        const fBit = (entry.word1_limit >>> 30) & 1;

        const permPass = requiredPerm === null || this.mElevation || !!parsed.permissions[requiredPerm];
        const auditEntry = {
            gate: 'mLoad',
            label: this.nsLabels[parsed.index] || 'entry_'+parsed.index,
            nsIndex: parsed.index,
            requiredPerm,
            checks: {
                version: { pass: versionMatch },
                seal:    { pass: sealValid },
                perm:    { pass: permPass, perm: requiredPerm },
            },
            b: bBit, f: fBit,
            result: (versionMatch && sealValid && permPass) ? 'pass' : 'fail',
        };
        this.auditLog.push(auditEntry);
        this.lastCapability = {
            op: requiredPerm,
            label: auditEntry.label,
            perms: parsed.permissions,
            b: bBit,
            f: fBit,
            versionMatch,
            sealValid,
        };
        if (!versionMatch) {
            return { ok: false, fault: 'VERSION', message: `gt_seq mismatch: GT seq ${parsed.gt_seq}, entry seq ${nsGtSeq}` };
        }
        if (!sealValid) {
            return { ok: false, fault: 'SEAL', message: `CRC seal validation failed for entry ${parsed.index}` };
        }
        if (requiredPerm !== null && !this.mElevation && !parsed.permissions[requiredPerm]) {
            return { ok: false, fault: 'PERMISSION', message: `lacks ${requiredPerm} permission` };
        }
        this.markLive(parsed.index);
        return { ok: true, parsed, entry, index: parsed.index };
    }

    mSave(gt32, targetIdx, srcCRIdx) {
        const parsed = this.parseGT(gt32);
        const srcEntry = this.readNSEntry(parsed.index);
        if (!srcEntry) {
            return { ok: false, fault: 'BOUNDS', message: `source entry ${parsed.index} is null` };
        }

        const srcVersionMatch = parsed.gt_seq === ((srcEntry.word2_seals >>> 25) & 0x7F);
        const srcSealValid = this.validateMAC(srcEntry);

        const bBit = parsed.permissions.B || 0;
        const fBit = (srcEntry.word1_limit >>> 30) & 1;

        const bindPass = bBit === 1 || this.mElevation;
        let farPass = true;
        if (targetIdx !== null && targetIdx !== undefined) {
            const tgtEntry = this.readNSEntry(targetIdx);
            if (tgtEntry) {
                const tgtWord1 = this.parseNSWord1(tgtEntry.word1_limit);
                if (tgtWord1.f === 1 && !this.mElevation) farPass = false;
            }
        }
        const saveAudit = {
            gate: 'mSave',
            label: this.nsLabels[parsed.index] || 'entry_'+parsed.index,
            nsIndex: parsed.index,
            requiredPerm: 'S',
            checks: {
                version: { pass: srcVersionMatch },
                seal:    { pass: srcSealValid },
                bind:    { pass: bindPass },
                far:     { pass: farPass },
            },
            b: bBit, f: fBit,
            result: (srcVersionMatch && srcSealValid && bindPass && farPass) ? 'pass' : 'fail',
        };
        this.auditLog.push(saveAudit);
        this.lastCapability = {
            op: 'S',
            label: saveAudit.label,
            perms: parsed.permissions,
            b: bBit,
            f: fBit,
            versionMatch: srcVersionMatch,
            sealValid: srcSealValid,
        };
        if (!srcVersionMatch) {
            return { ok: false, fault: 'VERSION', message: `source gt_seq mismatch: GT seq ${parsed.gt_seq}, entry seq ${(srcEntry.word2_seals >>> 25) & 0x7F}` };
        }
        if (!srcSealValid) {
            return { ok: false, fault: 'SEAL', message: `source CRC seal validation failed for entry ${parsed.index}` };
        }
        if (!bindPass) {
            return { ok: false, fault: 'BIND', message: `GT has B=0 — not bindable to c-list` };
        }
        if (!farPass) {
            return { ok: false, fault: 'FAR', message: `target slot ${targetIdx} is FAR (F=1) — requires HTTP/tunnel access` };
        }
        return { ok: true, parsed, srcEntry };
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
                log.push(`  CR${cr} -> NS[${idx}] "${label}" — LIVE (G=${liveValue})`);
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
                            log.push(`  CallStack ${crKey} -> NS[${idx}] "${label}" — LIVE (G=${liveValue})`);
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
                    log.push(`  C-List NS[${parentIdx}] -> NS[${childIdx}] "${label}" — LIVE (G=${liveValue})`);
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
            if (c.index === 0) {
                log.push(`  SKIP NS[0] "Boot.NS" — namespace root is protected`);
                continue;
            }
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
            log.push(`  CLEAR NS[${c.index}] "${c.label}" — version ${oldVersion}->${newVersion}, ${wordsCleared} object words zeroed`);

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
        log.push(`Namespace: ${priorCount} -> ${this.nsCount} entries (${freedSlots} swept)`);
        log.push(`Live: ${liveSet.size} entries protected by CR references`);
        log.push(`Next GC polarity flipped: G=${this.gcPolarity} will mean GARBAGE`);

        const report = log.join('\n');
        this.output += report + '\n';
        this.emit('stateChange', this.getState());
        return { freedSlots, freedWords, liveCount: liveSet.size, report };
    }

    _writeCR(crIdx, gt32, entry) {
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
        const names = ['LOAD','SAVE','CALL','RETURN','CHANGE','SWITCH','TPERM','LAMBDA','ELOADCALL','XLOADLAMBDA','DREAD','DWRITE','BFEXT','BFINS','MCMP','IADD','ISUB','BRANCH','SHL','SHR'];
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

    _packFrameWord(returnPC, sz, savedSTO) {
        const { N, Z, C, V } = this.flags;
        const flagBits = ((N ? 1 : 0) << 3) | ((Z ? 1 : 0) << 2) | ((C ? 1 : 0) << 1) | (V ? 1 : 0);
        return (
            ((flagBits & 0xF) << 28) |
            ((returnPC & 0x7FFF) << 13) |
            ((sz & 1) << 12) |
            (savedSTO & 0xFFF)
        ) >>> 0;
    }

    _unpackFrameWord(word) {
        const flagBits = (word >>> 28) & 0xF;
        return {
            flags:    { N: !!(flagBits & 8), Z: !!(flagBits & 4), C: !!(flagBits & 2), V: !!(flagBits & 1) },
            returnPC: (word >>> 13) & 0x7FFF,
            sz:       (word >>> 12) & 1,
            savedSTO: word & 0xFFF,
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
        if (this.abstractionRegistry) {
            const idxMatch = message.match(/(?:entry|index|slot|CR)\s*(\d+)/i);
            if (idxMatch) {
                const idx = parseInt(idxMatch[1]);
                if (idx < 45) this.abstractionRegistry.reportFault(idx);
            }
        }
        this.emit('fault', entry);
        this.emit('output', this.output);
    }

    _fetchInstruction() {
        if (!this.bootComplete) {
            if (this.pc >= this.memory.length) {
                return { ok: false, fault: 'BOUNDS', message: `PC=${this.pc} out of memory (pre-boot)` };
            }
            return { ok: true, word: this.memory[this.pc], addr: this.pc };
        }

        const cr7 = this.cr[7];
        if (!cr7 || cr7.word0 === 0) {
            return { ok: false, fault: 'NULL_CAP', message: 'CR14 (code register) is NULL — no code capability' };
        }
        const cr7Parsed = this.parseGT(cr7.word0);
        if (!cr7Parsed.permissions.X) {
            return { ok: false, fault: 'PERM_X', message: 'CR14 lacks X permission for instruction fetch' };
        }
        const entry = this.readNSEntry(cr7Parsed.index);
        if (!entry) {
            return { ok: false, fault: 'BOUNDS', message: `CR14 NS entry ${cr7Parsed.index} not found` };
        }
        const w1 = this.parseNSWord1(entry.word1_limit);
        if (this.pc >= w1.limit) {
            return { ok: false, fault: 'BOUNDS', message: `PC=${this.pc} exceeds CR14 code limit (${w1.limit})` };
        }
        const fetchAddr = entry.word0_location + this.pc;
        if (fetchAddr >= this.memory.length) {
            return { ok: false, fault: 'BOUNDS', message: `fetch address 0x${fetchAddr.toString(16)} out of memory` };
        }
        return { ok: true, word: this.memory[fetchAddr], addr: fetchAddr };
    }

    step() {
        if (this.halted) return null;
        this.auditLog = [];

        const fetch = this._fetchInstruction();
        if (!fetch.ok) {
            this.fault(fetch.fault, fetch.message);
            return null;
        }
        const instrWord = fetch.word;
        if (instrWord === 0) {
            this.output += `[PP250] Zero instruction at PC=${this.pc} (addr=0x${fetch.addr.toString(16)}) — no HALT, returning to boot sequence\n`;
            this._returnToBoot();
            return { pc: this.pc, instr: null, desc: 'PP250: zero instruction -> reboot' };
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
            result.auditPipeline = this._auditPipeline();
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
        const check = this.mLoad(clistGT, d.crSrc === 6 ? null : 'L', d.crSrc);
        if (!check.ok) {
            this.fault(check.fault, `LOAD: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const clistLoc = check.entry.word0_location;
        const slotGT = this.memory[clistLoc + d.imm] || 0;
        if (slotGT === 0) {
            this.fault('NULL_CAP', `LOAD: c-list offset ${d.imm} is empty (NULL GT)`);
            return null;
        }
        const slotParsed = this.parseGT(slotGT);

        if (d.crSrc === 6) {
            const permCheck = this._validateClistSlotPerms(slotParsed, d.imm);
            if (!permCheck.ok) {
                this.fault(permCheck.fault, `LOAD: ${permCheck.message}`);
                return null;
            }
        }

        const targetIdx = slotParsed.index;
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
        if (!this._writeCR(d.crDst, slotGT, entry)) return null;
        const label = this.nsLabels[targetIdx] || 'entry_'+targetIdx;
        const desc = `LOAD CR${d.crDst}, [CR${d.crSrc} + ${d.imm}] -> ${label}`;
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
        const saveCheck = this.mSave(srcGT, null, d.crDst);
        if (!saveCheck.ok) {
            this.fault(saveCheck.fault, `SAVE: CR${d.crDst}: ${saveCheck.message}`);
            return null;
        }
        const savedCap = this.lastCapability;
        const clistGT = this.cr[d.crSrc].word0;
        if (clistGT === 0) {
            this.fault('NULL_CAP', `SAVE: CR${d.crSrc} C-List is NULL`);
            return null;
        }
        const clistCheck = this.mLoad(clistGT, 'S', d.crSrc);
        if (!clistCheck.ok) {
            this.fault(clistCheck.fault, `SAVE: CR${d.crSrc}: ${clistCheck.message}`);
            return null;
        }
        this.lastCapability = savedCap;

        if (d.crSrc === 6) {
            const srcParsedCheck = this.parseGT(srcGT);
            const slotPermCheck = this._validateClistSlotPerms(srcParsedCheck, d.imm);
            if (!slotPermCheck.ok) {
                this.fault(slotPermCheck.fault, `SAVE: ${slotPermCheck.message}`);
                return null;
            }
        }

        const clistLoc = clistCheck.entry.word0_location;
        this.memory[clistLoc + d.imm] = srcGT;
        const srcParsed = saveCheck.parsed;
        const clistIdx = clistCheck.parsed.index;
        if (!this.nsClistMap[clistIdx]) {
            this.nsClistMap[clistIdx] = [];
        }
        if (!this.nsClistMap[clistIdx].includes(srcParsed.index)) {
            this.nsClistMap[clistIdx].push(srcParsed.index);
        }
        const label = this.nsLabels[srcParsed.index] || 'entry_'+srcParsed.index;
        if (srcParsed.index === 12) {
            this.ledBits = this.dr[0] & 0x3F;
            this.ledMode = 'program';
        }
        const desc = `SAVE CR${d.crDst} -> [CR${d.crSrc} + ${d.imm}] (${label})`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc };
    }

    _execCall(d) {
        const sourceGT = this.cr[d.crDst].word0;
        if (sourceGT === 0) {
            this.fault('NULL_CAP', `CALL: CR${d.crDst} is NULL`);
            return null;
        }
        const srcParsed = this.parseGT(sourceGT);
        if (srcParsed.type === 0) {
            this.fault('TYPE', `CALL: CR${d.crDst} GT type is NULL — cannot CALL a NULL GT`);
            return;
        }
        if (srcParsed.type !== 1 && srcParsed.type !== 2) {
            this.fault('TYPE', `CALL: CR${d.crDst} GT type is ${srcParsed.typeName}, must be Real or Abstract`);
            return null;
        }
        const check = this.mLoad(sourceGT, 'E', d.crDst);
        if (!check.ok) {
            this.fault(check.fault, `CALL: CR${d.crDst}: ${check.message}`);
            return null;
        }
        const nsEntry = check.entry;
        const word1 = this.parseNSWord1(nsEntry.word1_limit);
        if (word1.f === 1) {
            this.fault('FAR', `CALL: CR${d.crDst} has F-bit set (Far)`);
            return null;
        }

        const handler = this.nsHandlers[check.index];
        if (handler) {
            this._writeCR(6, sourceGT, nsEntry);
            return this._dispatchHandler(d, check, handler);
        }

        if (this.abstractionRegistry) {
            const abstraction = this.abstractionRegistry.getAbstraction(check.index);
            if (abstraction && abstraction.methods.length > 0) {
                this.abstractionRegistry.activate(check.index);
                this._writeCR(6, sourceGT, nsEntry);
                return this._dispatchAbstraction(d, check, abstraction);
            }
        }

        const savedSTO = this.sto;
        const frameWord = this._packFrameWord(this.pc + 1, 1, savedSTO);
        this.callStack.push({
            returnPC:   this.pc + 1,
            savedCRs:   this.cr.map(c => ({...c})),
            savedDRs:   [...this.dr],
            savedFlags: {...this.flags},
            savedSTO,
            sz: 1,
            frameWord,
        });
        this.sto = (savedSTO + 2) & 0xFFF;

        const clistCount = word1.clistCount;
        const limit = word1.limit;
        const base = nsEntry.word0_location;
        const label = this.nsLabels[check.index] || 'abstraction';
        let cr7Desc = '';

        if (clistCount > 0) {
            const allocSize = limit + 1;
            const clistStart = allocSize - clistCount;

            const cr7GT = this.createGT(srcParsed.gt_seq, check.index, {R:1,W:1,X:1,L:0,S:0,E:0}, 1);
            const cr7Word1 = this.packNSWord1(clistStart - 1, 0, 0, 0, 0, 1, 0);
            this.cr[7] = {
                word0: cr7GT,
                word1: base,
                word2: cr7Word1,
                word3: nsEntry.word2_seals,
                m: this.mElevation ? 1 : 0
            };

            const cr6GT = this.createGT(srcParsed.gt_seq, check.index, {R:0,W:0,X:0,L:1,S:0,E:0}, 1);
            const cr6Word1 = this.packNSWord1(clistCount - 1, 0, 0, 0, 0, 1, 0);
            this.cr[6] = {
                word0: cr6GT,
                word1: (base + clistStart) >>> 0,
                word2: cr6Word1,
                word3: nsEntry.word2_seals,
                m: this.mElevation ? 1 : 0
            };

            cr7Desc = `, CR14(code,X,lim=${clistStart-1}), CR6(clist,L,lim=${clistCount-1})`;
        } else {
            this._writeCR(6, sourceGT, nsEntry);

            const clistLoc = nsEntry.word0_location;
            const cr7GT = this.memory[clistLoc];
            if (cr7GT !== 0) {
                const cr7Parsed = this.parseGT(cr7GT);
                if (cr7Parsed.type === 1 && cr7Parsed.permissions.X) {
                    const cr7Entry = this.readNSEntry(cr7Parsed.index);
                    if (cr7Entry) {
                        const cr7Word1p = this.parseNSWord1(cr7Entry.word1_limit);
                        if (cr7Word1p.f !== 1) {
                            const cr7Check = this.mLoad(cr7GT, 'X', undefined);
                            if (cr7Check.ok) {
                                this._writeCR(7, cr7GT, cr7Check.entry);
                                cr7Desc = `, CR14 <- X-GT(Slot ${cr7Parsed.index})`;
                            }
                        }
                    }
                }
            }
        }

        const desc = `CALL CR${d.crDst} -> ${label}: clistCount=${clistCount}${cr7Desc}`;
        this.output += desc + '\n';
        const prevPC = this.pc;
        this.pc = 0;
        return { pc: prevPC, instr: d, desc, pipeline: this._callPipeline(d, label) };
    }

    _dispatchAbstraction(d, check, abstraction) {
        const label = abstraction.name;

        if (check.index === 5) {
            const cr1GT = this.cr[1].word0;
            if (cr1GT !== 0) {
                const cr1Parsed = this.parseGT(cr1GT);
                if (cr1Parsed.type === 2) {
                    const desc = `CALL CR${d.crDst} -> Navana.ValidatePassKey [PassKey in CR1]`;
                    this.output += desc + '\n';

                    const result = this.abstractionRegistry.dispatchMethod(5, 'ValidatePassKey', this, {
                        passKeyGT: cr1GT
                    });

                    if (result && result.ok) {
                        const driverGT = result.result.driverGT;
                        if (driverGT) {
                            const driverParsed = this.parseGT(driverGT);
                            const driverEntry = this.readNSEntry(driverParsed.index);
                            if (driverEntry) {
                                this._writeCR(1, driverGT, driverEntry);
                                this.output += `  ${result.message}\n`;
                                this.output += `  CR1 <- E-perm LED driver (NS[${driverParsed.index}])\n`;
                            } else {
                                this.output += `  ValidatePassKey succeeded but driver NS[${driverParsed.index}] entry missing\n`;
                                this.fault('PERM', `CALL Navana: driver NS entry not found at index ${driverParsed.index}`);
                                return null;
                            }
                        } else {
                            this.output += `  ValidatePassKey succeeded but no driver GT returned\n`;
                            this.fault('PERM', 'CALL Navana: no driver GT in validation result');
                            return null;
                        }
                        this.dr[0] = result.result.permMask || 0;
                    } else {
                        this.output += `  ${result ? result.message : 'Navana.ValidatePassKey failed'}\n`;
                        this.fault('PERM', `CALL Navana: PassKey validation failed — ${result ? result.message : 'unknown error'}`);
                        return null;
                    }

                    this.pc++;
                    return { pc: this.pc - 1, instr: d, desc, pipeline: [
                        { stage: 'CALL', desc: 'Enter Navana (PassKey gate)', perm: 'E', status: 'pass' },
                        { stage: 'VALIDATE', desc: `PassKey validated for ${result.result.device}`, status: 'pass' },
                        { stage: 'GRANT', desc: 'CR1 <- E-perm LED driver', status: 'pass' },
                        { stage: 'RETURN', desc: 'Exit Navana', status: 'pass' },
                    ]};
                }
            }

            const methodName = this._selectNavanaMethod(d) || abstraction.methods[0] || 'Apply';
            const desc = `CALL CR${d.crDst} -> ${label}.${methodName} [abstraction dispatch]`;
            this.output += desc + '\n';

            if (this.abstractionRegistry) {
                const result = this.abstractionRegistry.dispatchMethod(check.index, methodName, this, {
                    dr0: this.dr[0], dr1: this.dr[1]
                });
                if (result && result.message) {
                    this.output += `  ${result.message}\n`;
                }
                if (result && !result.ok && result.fault) {
                    this.fault(result.fault, `${label}.${methodName}: ${result.message}`);
                    this.pc++;
                    return { pc: this.pc - 1, instr: d, desc, pipeline: [
                        { stage: 'CALL', desc: `Enter ${label} abstraction`, perm: 'E', status: 'pass' },
                        { stage: 'DISPATCH', desc: `${label}.${methodName}`, status: 'fail' },
                        { stage: 'FAULT', desc: `${result.fault}: ${result.message}`, status: 'fail' },
                    ]};
                }
            }

            this.pc++;
            return { pc: this.pc - 1, instr: d, desc, pipeline: [
                { stage: 'CALL', desc: `Enter ${label} abstraction`, perm: 'E', status: 'pass' },
                { stage: 'DISPATCH', desc: `${label}.${methodName}`, status: 'pass' },
                { stage: 'RETURN', desc: `Exit ${label}`, status: 'pass' },
            ]};
        }

        const methodName = abstraction.methods[0] || 'Apply';
        const desc = `CALL CR${d.crDst} -> ${label}.${methodName} [abstraction dispatch]`;
        this.output += desc + '\n';

        if (this.abstractionRegistry) {
            const result = this.abstractionRegistry.dispatchMethod(check.index, methodName, this, {});
            if (result && result.message) {
                this.output += `  ${result.message}\n`;
            }
        }

        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: [
            { stage: 'CALL', desc: `Enter ${label} abstraction`, perm: 'E', status: 'pass' },
            { stage: 'DISPATCH', desc: `${label}.${methodName}`, status: 'pass' },
            { stage: 'RETURN', desc: `Exit ${label}`, status: 'pass' },
        ]};
    }

    _selectNavanaMethod(d) {
        const dr0 = this.dr[0];
        if (dr0 === 0) return 'Init';
        if (dr0 === 1) return 'Manage';
        if (dr0 === 2) return 'Monitor';
        if (dr0 === 3) return 'IDS';
        if (dr0 === 4) return 'MintPassKey';
        if (dr0 === 5) return 'GetPassKeyAuditLog';
        return null;
    }

    _dispatchHandler(d, check, handler) {
        const label = this.nsLabels[check.index] || 'handler';
        switch (handler) {
            case 'gc': {
                const desc = `CALL CR${d.crDst} -> ${label} [safe Turing abstraction: GC]`;
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
            case 'led_driver': {
                const desc = `CALL CR${d.crDst} -> ${label} [LED driver E-perm abstraction]`;
                this.output += desc + '\n';

                const dr0 = this.dr[0];
                const dr1 = this.dr[1];
                const callerGT = this.cr[d.crDst].word0;

                if (this.abstractionRegistry) {
                    const result = this.abstractionRegistry.dispatchMethod(5, 'CallLEDDriver', this, {
                        callerGT: callerGT,
                        dr0: dr0,
                        dr1: dr1
                    });

                    if (result && result.ok) {
                        this.output += `  ${result.message}\n`;
                        if (result.result && result.result.state !== undefined) {
                            this.dr[0] = result.result.state;
                        }
                        if (result.result && result.result.led !== undefined) {
                            this.dr[0] = result.result.state || 0;
                        }
                    } else {
                        this.output += `  ${result ? result.message : 'LED driver call failed'}\n`;
                        this.fault('PERM', `LED driver: ${result ? result.message : 'unknown error'}`);
                        return null;
                    }
                }

                this.pc++;
                const methodNames = ['Set', 'Clear', 'Pattern', 'Get'];
                const methodSelector = (dr0 >>> 24) & 0xFF;
                let dispatchMethod;
                if (methodSelector > 0 && methodSelector <= 3) {
                    dispatchMethod = methodSelector;
                } else if (dr1 > 0) {
                    dispatchMethod = 0;
                } else {
                    dispatchMethod = 2;
                }
                const methodName = methodNames[dispatchMethod] || 'Set';
                return { pc: this.pc - 1, instr: d, desc, pipeline: [
                    { stage: 'CALL', desc: `Enter LED driver`, perm: 'E', status: 'pass' },
                    { stage: 'DISPATCH', desc: `LED.${methodName}(DR0=0x${dr0.toString(16)}, DR1=0x${dr1.toString(16)})`, status: 'pass' },
                    { stage: 'DEVICE', desc: `Hardware write at 0xFE10`, status: 'pass' },
                    { stage: 'RETURN', desc: `Exit LED driver`, status: 'pass' },
                ]};
            }
            default:
                this.fault('HANDLER', `Unknown handler: ${handler}`);
                return null;
        }
    }

    _execReturn(d) {
        if (this.callStack.length === 0) {
            this.output += `[PP250] RETURN with empty call stack — no HALT, returning to boot sequence\n`;
            this._returnToBoot();
            return { pc: this.pc, instr: d, desc: 'PP250: RETURN (empty stack) -> reboot' };
        }
        const mask = d.imm & 0xFFF;
        const frame = this.callStack.pop();
        if (frame.savedCRs) {
            for (let i = 0; i < frame.savedCRs.length; i++) {
                this.cr[i] = {...frame.savedCRs[i]};
            }
        }
        if (frame.savedDRs) this.dr = [...frame.savedDRs];
        if (frame.savedFlags) this.flags = {...frame.savedFlags};
        if (typeof frame.savedSTO === 'number') this.sto = frame.savedSTO;
        const clearedCRs = [];
        for (let i = 0; i < 12; i++) {
            if (mask & (1 << i)) {
                this._clearCR(i);
                clearedCRs.push(`CR${i}`);
            }
        }
        const frameTag = frame.sz === 0 ? 'LAMBDA' : 'CALL';
        const maskDesc = mask ? ` MASK=0b${mask.toString(2).padStart(12, '0')} cleared[${clearedCRs.join(',')}]` : '';
        const desc = `RETURN (${frameTag}/SZ=${frame.sz}) PC→${frame.returnPC}${maskDesc}`;
        this.output += desc + '\n';
        this.pc = frame.returnPC;
        return { pc: frame.returnPC, instr: d, desc, pipeline: this._returnPipeline(d, frame, mask) };
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
        const desc = `SWITCH CR${d.crSrc} <-> CR${target}`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc };
    }

    _execTperm(d) {
        const gt = this.cr[d.crDst].word0;
        const bSet = (d.imm >>> 4) & 1;
        const presetCode = d.imm & 0xF;

        const presetMasks = [
            [],                ['R'],           ['R','W'],       ['X'],
            ['R','X'],         ['R','W','X'],   ['L'],           ['S'],
            ['E'],             ['L','S'],       ['W'],           null,
            null,              null,            null,            null,
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

        if (bSet && hasAll) {
            this.cr[d.crDst].word0 = (this.cr[d.crDst].word0 & ~(1 << 31)) >>> 0;
        }

        this.flags.Z = hasAll;
        this.flags.N = !hasAll;
        this.flags.C = false;
        this.flags.V = false;

        const permStr = (required.join('') || 'CLEAR') + (bSet ? '+B' : '');
        const result = hasAll ? 'PASS' : 'FAIL';
        const bMsg = (bSet && hasAll) ? ' B->0' : '';
        const desc = `TPERM CR${d.crDst}, ${permStr} -> ${result} (Z=${hasAll ? 1 : 0})${bMsg}`;
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
        const check = this.mLoad(targetGT, 'X', crIdx);
        if (!check.ok) {
            this.fault(check.fault, `LAMBDA: CR${crIdx}: ${check.message}`);
            return null;
        }

        const savedSTO = this.sto;
        const frameWord = this._packFrameWord(this.pc + 1, 0, savedSTO);
        this.callStack.push({
            returnPC:   this.pc + 1,
            savedCRs:   this.cr.map(c => ({...c})),
            savedFlags: {...this.flags},
            savedSTO,
            sz: 0,
            frameWord,
            isLambda: true,
        });
        this.sto = (savedSTO + 1) & 0xFFF;

        const label = this.nsLabels[check.index] || 'reduction';
        const desc = `LAMBDA CR${crIdx} -> ${label} [SZ=0, STO:${savedSTO}->${this.sto}]`;
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
        const loadCheck = this.mLoad(clistGT, d.crSrc === 6 ? null : 'L', d.crSrc);
        if (!loadCheck.ok) {
            this.fault(loadCheck.fault, `ELOADCALL LOAD: CR${d.crSrc}: ${loadCheck.message}`);
            return null;
        }

        const srcLoc = loadCheck.entry.word0_location;
        const slotGT = this.memory[srcLoc + d.imm] || 0;
        if (slotGT === 0) {
            this.fault('NULL_CAP', `ELOADCALL: c-list offset ${d.imm} is empty`);
            return null;
        }
        const slotParsed = this.parseGT(slotGT);
        const targetIdx = slotParsed.index;
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

        if (!this._writeCR(d.crDst, slotGT, entry)) return null;

        const tpermCheck = this.mLoad(slotGT, 'E', d.crDst);
        if (!tpermCheck.ok) {
            this.fault(tpermCheck.fault, `ELOADCALL TPERM: CR${d.crDst}: ${tpermCheck.message}`);
            return null;
        }

        const clistEntry = tpermCheck.entry;
        const clistLoc = clistEntry.word0_location;
        const cr7GT = this.memory[clistLoc];
        if (cr7GT !== 0) {
            const cr7Parsed = this.parseGT(cr7GT);
            if (cr7Parsed.type === 1 || cr7Parsed.type === 2) {
                const cr7Entry = this.readNSEntry(cr7Parsed.index);
                if (cr7Entry) {
                    const cr7Check = this.mLoad(cr7GT, 'X', undefined);
                    if (cr7Check.ok) {
                        this._writeCR(6, slotGT, clistEntry);
                        this._writeCR(7, cr7GT, cr7Check.entry);
                    }
                }
            }
        }

        const savedSTO_ec = this.sto;
        const frameWord_ec = this._packFrameWord(this.pc + 1, 1, savedSTO_ec);
        this.callStack.push({
            returnPC:   this.pc + 1,
            savedCRs:   this.cr.map(c => ({...c})),
            savedDRs:   [...this.dr],
            savedFlags: {...this.flags},
            savedSTO:   savedSTO_ec,
            sz: 1,
            frameWord:  frameWord_ec,
        });
        this.sto = (savedSTO_ec + 2) & 0xFFF;

        const label = this.nsLabels[targetIdx] || 'abstraction';
        const desc = `ELOADCALL CR${d.crDst}, [CR${d.crSrc} + ${d.imm}] -> ${label} (LOAD+TPERM+CALL)`;
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
        const loadCheck = this.mLoad(clistGT, d.crSrc === 6 ? null : 'L', d.crSrc);
        if (!loadCheck.ok) {
            this.fault(loadCheck.fault, `XLOADLAMBDA LOAD: CR${d.crSrc}: ${loadCheck.message}`);
            return null;
        }

        const srcLoc = loadCheck.entry.word0_location;
        const slotGT = this.memory[srcLoc + d.imm] || 0;
        if (slotGT === 0) {
            this.fault('NULL_CAP', `XLOADLAMBDA: c-list offset ${d.imm} is empty`);
            return null;
        }
        const slotParsed = this.parseGT(slotGT);
        const targetIdx = slotParsed.index;
        if (targetIdx >= this.nsCount || !this.isNSEntryValid(targetIdx)) {
            this.fault('BOUNDS', `XLOADLAMBDA: slot ${targetIdx} out of bounds`);
            return null;
        }
        const entry = this.readNSEntry(targetIdx);
        if (!entry) {
            this.fault('BOUNDS', `XLOADLAMBDA: slot ${targetIdx} is null`);
            return null;
        }
        if (!this.validateMAC(entry)) {
            this.fault('SEAL', `XLOADLAMBDA: slot ${targetIdx} seal failed`);
            return null;
        }

        if (!this._writeCR(d.crDst, slotGT, entry)) return null;

        if (!slotParsed.permissions.X) {
            this.fault('PERMISSION', `XLOADLAMBDA TPERM: CR${d.crDst} lacks X permission`);
            return null;
        }

        const label = this.nsLabels[targetIdx] || 'slot';
        const desc = `XLOADLAMBDA CR${d.crDst}, [CR${d.crSrc} + ${d.imm}] -> ${label} (LOAD+TPERM+LAMBDA)`;
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
        const check = this.mLoad(dataGT, 'R', d.crSrc);
        if (!check.ok) {
            this.fault(check.fault, `DREAD: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const srcCR = this.cr[d.crSrc];
        const loc = srcCR.word1;
        const lim = this.parseNSWord1(srcCR.word2);
        const offset = d.imm;
        if (offset > lim.limit) {
            this.fault('BOUNDS', `DREAD: offset ${offset} exceeds DATA limit ${lim.limit}`);
            return null;
        }
        const value = this.memory[loc + offset];
        this.dr[drIdx] = value >>> 0;
        const label = this.nsLabels[check.index] || 'data';
        const desc = `DREAD DR${drIdx}, [CR${d.crSrc} + ${offset}] -> 0x${(value >>> 0).toString(16).toUpperCase().padStart(8,'0')} (${label})`;
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
        const check = this.mLoad(dataGT, 'W', d.crSrc);
        if (!check.ok) {
            this.fault(check.fault, `DWRITE: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const srcCR = this.cr[d.crSrc];
        const loc = srcCR.word1;
        const lim = this.parseNSWord1(srcCR.word2);
        const offset = d.imm;
        if (offset > lim.limit) {
            this.fault('BOUNDS', `DWRITE: offset ${offset} exceeds DATA limit ${lim.limit}`);
            return null;
        }
        const value = this.dr[drIdx] >>> 0;
        this.memory[loc + offset] = value;
        const label = this.nsLabels[check.index] || 'data';
        const desc = `DWRITE DR${drIdx}, [CR${d.crSrc} + ${offset}] <- 0x${value.toString(16).toUpperCase().padStart(8,'0')} (${label})`;
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
        const check = this.mLoad(dataGT, 'R', d.crSrc);
        if (!check.ok) {
            this.fault(check.fault, `BFEXT: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const loc = this.cr[d.crSrc].word1;
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
        const desc = `BFEXT DR${drIdx}, [CR${d.crSrc}], pos=${pos}, w=${width} -> 0x${value.toString(16).toUpperCase()} (${label})`;
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
        const check = this.mLoad(dataGT, 'W', d.crSrc);
        if (!check.ok) {
            this.fault(check.fault, `BFINS: CR${d.crSrc}: ${check.message}`);
            return null;
        }
        const loc = this.cr[d.crSrc].word1;
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
        const desc = `BFINS DR${drIdx}, [CR${d.crSrc}], pos=${pos}, w=${width} <- 0x${(insertVal & ((1 << width) - 1)).toString(16).toUpperCase()} (${label})`;
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
        const desc = `MCMP DR${d.crDst}, DR${d.crSrc} -> ${a} vs ${b} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=${this.flags.C?1:0} V=${this.flags.V?1:0}]`;
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
        const desc = `IADD DR${d.crDst}, DR${drA}, DR${drB} -> ${a} + ${b} = ${result >>> 0} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=${this.flags.C?1:0} V=${this.flags.V?1:0}]`;
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
        const desc = `ISUB DR${d.crDst}, DR${drA}, DR${drB} -> ${a} - ${b} = ${result >>> 0} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=${this.flags.C?1:0} V=${this.flags.V?1:0}]`;
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
        const desc = `BRANCH ${soff >= 0 ? '+' : ''}${soff} -> PC=${target}`;
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
        const desc = `SHL DR${d.crDst}, DR${drSrc}, ${shamt} -> 0x${result.toString(16).toUpperCase().padStart(8,'0')} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=${this.flags.C?1:0}]`;
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
        const desc = `SHR DR${d.crDst}, DR${drSrc}, ${shamt} ${shType} -> 0x${result.toString(16).toUpperCase().padStart(8,'0')} [Z=${this.flags.Z?1:0} N=${this.flags.N?1:0} C=${this.flags.C?1:0}]`;
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
            { stage: 'VALIDATE', desc: `CRC-16 seal check on entry ${d.imm}`, status: 'pass' },
            { stage: 'WRITE', desc: `Write ${label} to CR${d.crDst}`, status: 'pass' },
        ];
    }

    _callPipeline(d, label) {
        return [
            { stage: 'LOAD',  desc: `Read target GT from CR${d.crDst}`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify E permission on target`, perm: 'E', status: 'pass' },
            { stage: 'PUSH',  desc: `Push E-GT (word 0) + frame word (SZ=1): FLAGS|PC|SZ|STO`, status: 'pass' },
            { stage: 'CALL',  desc: `Enter ${label}, CR6/CR14 derived, PC←0`, status: 'pass' },
        ];
    }

    _returnPipeline(d, frame, mask) {
        const stages = [];
        const frameTag = frame.sz === 0 ? 'LAMBDA' : 'CALL';
        stages.push({ stage: 'POP', desc: `Pop ${frame.sz === 0 ? '1-word LAMBDA' : '2-word CALL'} frame; restore FLAGS, STO←${frame.savedSTO}`, status: 'pass' });
        if (frame.sz === 1) {
            stages.push({ stage: 'E-GT', desc: 'Revalidate caller E-GT → re-derive CR6/CR14', perm: 'E', status: 'pass' });
        }
        stages.push({ stage: 'RETURN', desc: `PC→${frame.returnPC}${mask ? `, MASK clears ${mask.toString(2).padStart(12,'0')}` : ''}`, status: 'pass' });
        return stages;
    }

    _tpermPipeline(d, parsed, hasAll) {
        const permBits = [];
        for (const p of ['R','W','X','L','S','E']) {
            if (parsed.permissions[p]) permBits.push(p);
        }
        return [
            { stage: 'TPERM', desc: `Check permissions [${permBits.join(',')}] -> ${hasAll ? 'PASS' : 'FAIL'}`, status: hasAll ? 'pass' : 'fail' },
        ];
    }

    _lambdaPipeline(d, label) {
        return [
            { stage: 'LOAD',   desc: `Read CR${d.crDst} GT`, perm: 'L', status: 'pass' },
            { stage: 'TPERM',  desc: `Verify X permission`, perm: 'X', status: 'pass' },
            { stage: 'PUSH',   desc: `Push 1-word frame (SZ=0): FLAGS|PC|SZ|STO`, status: 'pass' },
            { stage: 'LAMBDA', desc: `Church reduction via ${label}`, status: 'pass' },
        ];
    }

    _auditPipeline() {
        return this.auditLog.map(a => {
            const checks = a.checks;
            const checkList = Object.entries(checks).map(([k, v]) => ({
                name: k.toUpperCase(),
                pass: v.pass,
                perm: v.perm || null,
            }));
            return {
                stage: a.gate,
                type: a.gate,
                desc: `${a.gate}(NS[${a.nsIndex}]="${a.label}"${a.requiredPerm ? ', '+a.requiredPerm : ''})`,
                label: a.label,
                nsIndex: a.nsIndex,
                requiredPerm: a.requiredPerm,
                checks: checkList,
                status: a.result,
                b: a.b,
                f: a.f,
            };
        });
    }

    loadProgram(words, startAddr) {
        const abstrSlot = 2;
        const abstrBase = this.NS_TABLE_BASE + abstrSlot * this.NS_ENTRY_WORDS;
        const codeLoc = this.memory[abstrBase] || (abstrSlot * this.SLOT_SIZE);
        const baseAddr = this.bootComplete ? codeLoc : (startAddr || 0);
        for (let i = 0; i < words.length; i++) {
            if (baseAddr + i < this.memory.length) {
                this.memory[baseAddr + i] = words[i] >>> 0;
            }
        }
        this.pc = 0;
        this.halted = false;
        this.running = false;
        this.emit('programLoaded', { addr: baseAddr, length: words.length });
        this.emit('stateChange', this.getState());
    }

    loadHardwareBinary(hwProgram, hwNamespace, hwClist, hwLabels, abstractions) {
        this.reset();

        this.memory = new Uint32Array(65536);
        this.nsLabels = {};
        this.nsCount = 0;
        this.nsClistMap = {};

        const nsEntryCount = hwNamespace.length / 3;
        for (let i = 0; i < nsEntryCount; i++) {
            const loc  = hwNamespace[i * 3 + 0];
            const w1   = hwNamespace[i * 3 + 1];
            const parsed1 = this.parseNSWord1(w1);
            const base = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS;
            this.memory[base + 0] = loc >>> 0;
            this.memory[base + 1] = w1 >>> 0;
            this.memory[base + 2] = this.makeVersionSeals(0, loc, parsed1.limit);
            if (hwLabels && hwLabels[i]) {
                this.nsLabels[i] = hwLabels[i];
            } else {
                this.nsLabels[i] = `HW Slot ${i}`;
            }
            this.nsCount = i + 1;
        }

        const abstrSlot = 2;
        const abstrNSBase = this.NS_TABLE_BASE + abstrSlot * this.NS_ENTRY_WORDS;
        const abstrLoc = this.memory[abstrNSBase] || (abstrSlot * this.SLOT_SIZE);
        const abstrW1 = this.memory[abstrNSBase + 1];
        const abstrParsed = this.parseNSWord1(abstrW1);
        const abstrAllocSize = abstrParsed.limit + 1;
        const abstrClistCount = abstrParsed.clistCount || hwClist.length;
        const abstrClistStart = abstrAllocSize - abstrClistCount;
        const safeClistCopy = Math.min(hwClist.length, abstrClistCount);

        for (let i = 0; i < safeClistCopy; i++) {
            this.memory[abstrLoc + abstrClistStart + i] = hwClist[i] >>> 0;
        }

        for (let i = 0; i < hwProgram.length; i++) {
            if (hwProgram[i] !== 0) {
                this.memory[abstrLoc + i] = hwProgram[i] >>> 0;
            }
        }

        const clistChildren = [];
        for (let i = 0; i < nsEntryCount; i++) clistChildren.push(i);
        this.nsClistMap[2] = clistChildren;

        if (abstractions) {
            for (const abs of abstractions) {
                if (abs.clist && abs.nsIndex !== undefined) {
                    const absBase = this.NS_TABLE_BASE + abs.nsIndex * this.NS_ENTRY_WORDS;
                    const absLoc = this.memory[absBase];
                    for (let i = 0; i < abs.clist.length; i++) {
                        this.memory[absLoc + i] = abs.clist[i] >>> 0;
                    }
                }
                if (abs.code && abs.codeNsIndex !== undefined) {
                    const codeBase = this.NS_TABLE_BASE + abs.codeNsIndex * this.NS_ENTRY_WORDS;
                    const codeLoc = this.memory[codeBase];
                    for (let i = 0; i < abs.code.length; i++) {
                        this.memory[codeLoc + i] = abs.code[i] >>> 0;
                    }
                }
            }
        }

        this.output = '';
        this.output += '=== HARDWARE BINARY LOADED (Tang Nano 20K) ===\n';
        this.output += `Namespace: ${nsEntryCount} entries written to NS_TABLE_BASE (0x${this.NS_TABLE_BASE.toString(16).toUpperCase()})\n`;
        this.output += `Boot.Abstr: code at 0x${abstrLoc.toString(16).padStart(4,'0').toUpperCase()}, C-List (${abstrClistCount} GTs) at 0x${(abstrLoc + abstrClistStart).toString(16).padStart(4,'0').toUpperCase()}\n`;
        this.output += `Boot ROM: ${hwProgram.length} instructions at code region 0x${abstrLoc.toString(16).padStart(4,'0').toUpperCase()}\n`;
        if (abstractions) {
            for (const abs of abstractions) {
                const label = abs.label || `NS ${abs.nsIndex}`;
                this.output += `Abstraction: ${label} (NS ${abs.nsIndex}, code NS ${abs.codeNsIndex})\n`;
            }
        }
        this.output += '\n--- Namespace Entries ---\n';
        for (let i = 0; i < nsEntryCount; i++) {
            const base = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS;
            const loc = this.memory[base];
            const w1 = this.memory[base + 1];
            const parsed = this.parseNSWord1(w1);
            const label = this.nsLabels[i] || '';
            this.output += `  [${i.toString().padStart(2)}] ${label.padEnd(20)} loc=0x${loc.toString(16).padStart(4,'0')} lim=${parsed.limit} F=${parsed.f} G=${parsed.g}\n`;
        }
        this.output += '\n--- C-List GTs ---\n';
        for (let i = 0; i < hwClist.length; i++) {
            const gt = hwClist[i] >>> 0;
            const p = this.parseGT(gt);
            const permStr = (p.permissions.B ? 'B':'') + (p.permissions.R ? 'R':'') +
                           (p.permissions.W ? 'W':'') + (p.permissions.X ? 'X':'') +
                           (p.permissions.L ? 'L':'') + (p.permissions.S ? 'S':'') +
                           (p.permissions.E ? 'E':'');
            this.output += `  [${i}] 0x${gt.toString(16).padStart(8,'0')} ${p.typeName.padEnd(8)} ${(permStr||'------').padEnd(6)} -> idx ${p.index}\n`;
        }
        this.output += `\n--- CLOOMC Code (Boot.Abstr code region, at 0x${abstrLoc.toString(16).padStart(4,'0').toUpperCase()}) ---\n`;
        for (let i = 0; i < hwProgram.length; i++) {
            const w = hwProgram[i] >>> 0;
            if (w === 0) continue;
            this.output += `  PC=${i} (0x${(abstrLoc+i).toString(16).padStart(4,'0')}): 0x${w.toString(16).padStart(8,'0')}\n`;
        }
        if (abstractions) {
            for (const abs of abstractions) {
                if (abs.code && abs.codeNsIndex !== undefined) {
                    const codeBase = this.NS_TABLE_BASE + abs.codeNsIndex * this.NS_ENTRY_WORDS;
                    const codeLoc = this.memory[codeBase];
                    const label = abs.label || `NS ${abs.nsIndex}`;
                    this.output += `\n--- ${label} Code (NS ${abs.codeNsIndex}, at 0x${codeLoc.toString(16).padStart(4,'0').toUpperCase()}) ---\n`;
                    for (let i = 0; i < abs.code.length; i++) {
                        const w = abs.code[i] >>> 0;
                        if (w === 0) continue;
                        this.output += `  PC=${i} (0x${(codeLoc+i).toString(16).padStart(4,'0')}): 0x${w.toString(16).padStart(8,'0')}\n`;
                    }
                }
            }
        }
        this.output += '\nStep or Run to begin boot sequence with hardware data.\n';

        this.pc = 0;
        this.halted = false;
        this.running = false;
        this.bootComplete = false;
        this.mElevation = false;
        this.bootStep = 0;
        this.ledBits = 0; this.ledMode = 'boot';
        this.faultLog = [];
        this.stepCount = 0;
        this.callStack = [];
        this.sto = 0;

        this.emit('programLoaded', { addr: 0, length: hwProgram.length });
        this.emit('stateChange', this.getState());
    }

    loadImageFromBinary(nsWords, clistWords, bootProgram) {
        this.reset();

        this.memory = new Uint32Array(65536);
        this.nsLabels = {};
        this.nsCount = 0;
        this.nsClistMap = {};

        const NS_WORDS = 192;
        const CLIST_WORDS = 64;
        const nsEntryCount = Math.floor(Math.min(nsWords.length, NS_WORDS) / 3);

        for (let i = 0; i < nsEntryCount; i++) {
            const loc = nsWords[i * 3 + 0] >>> 0;
            const w1  = nsWords[i * 3 + 1] >>> 0;
            const w2  = nsWords[i * 3 + 2] >>> 0;
            const base = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS;
            this.memory[base + 0] = loc;
            this.memory[base + 1] = w1;
            this.memory[base + 2] = w2;
            this.nsLabels[i] = `Slot ${i}`;
            this.nsCount = i + 1;
        }

        const abstrSlot = 2;
        const abstrNSBase = this.NS_TABLE_BASE + abstrSlot * this.NS_ENTRY_WORDS;
        const abstrLoc = this.memory[abstrNSBase] || (abstrSlot * this.SLOT_SIZE);
        const abstrW1 = this.memory[abstrNSBase + 1];
        const abstrParsed = this.parseNSWord1(abstrW1);
        const abstrAllocSize = abstrParsed.limit + 1;
        const clistCount = Math.min(clistWords.length, CLIST_WORDS);
        const abstrClistCount = abstrParsed.clistCount || clistCount;
        const abstrClistStart = abstrAllocSize - abstrClistCount;
        const safeClistCopy = Math.min(clistCount, abstrClistCount);

        for (let i = 0; i < safeClistCopy; i++) {
            this.memory[abstrLoc + abstrClistStart + i] = clistWords[i] >>> 0;
        }

        const hwBoot = bootProgram || (typeof HW_BOOT_PROGRAM !== 'undefined' ? HW_BOOT_PROGRAM : null);
        if (hwBoot) {
            for (let i = 0; i < hwBoot.length; i++) {
                if (hwBoot[i] !== 0) {
                    this.memory[abstrLoc + i] = hwBoot[i] >>> 0;
                }
            }
        }

        const clistChildren = [];
        for (let i = 0; i < nsEntryCount; i++) clistChildren.push(i);
        this.nsClistMap[2] = clistChildren;

        this.output = '';
        this.output += '=== BINARY IMAGE LOADED ===\n';
        this.output += `Namespace: ${nsEntryCount} entries at NS_TABLE_BASE (0x${this.NS_TABLE_BASE.toString(16).toUpperCase()})\n`;
        this.output += `Boot.Abstr: code at 0x${abstrLoc.toString(16).padStart(4,'0').toUpperCase()}, C-List (${abstrClistCount} GTs) at 0x${(abstrLoc + abstrClistStart).toString(16).padStart(4,'0').toUpperCase()}\n`;
        this.output += '\n--- Namespace Entries ---\n';
        for (let i = 0; i < nsEntryCount; i++) {
            const base = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS;
            const loc = this.memory[base];
            const w1 = this.memory[base + 1];
            const parsed = this.parseNSWord1(w1);
            const label = this.nsLabels[i] || '';
            this.output += `  [${i.toString().padStart(2)}] ${label.padEnd(20)} loc=0x${loc.toString(16).padStart(4,'0')} lim=${parsed.limit} F=${parsed.f} G=${parsed.g}\n`;
        }
        this.output += '\n--- C-List GTs ---\n';
        for (let i = 0; i < clistCount; i++) {
            const gt = clistWords[i] >>> 0;
            if (gt === 0) continue;
            const p = this.parseGT(gt);
            const permStr = (p.permissions.B ? 'B':'') + (p.permissions.R ? 'R':'') +
                           (p.permissions.W ? 'W':'') + (p.permissions.X ? 'X':'') +
                           (p.permissions.L ? 'L':'') + (p.permissions.S ? 'S':'') +
                           (p.permissions.E ? 'E':'');
            this.output += `  [${i}] 0x${gt.toString(16).padStart(8,'0')} ${p.typeName.padEnd(8)} ${(permStr||'-------').padEnd(7)} -> idx ${p.index}\n`;
        }
        if (hwBoot) {
            this.output += `\n--- CLOOMC Code (Boot.Abstr code region, at 0x${abstrLoc.toString(16).padStart(4,'0').toUpperCase()}) ---\n`;
            for (let i = 0; i < hwBoot.length; i++) {
                const w = hwBoot[i] >>> 0;
                if (w === 0) continue;
                const disasm = (typeof ChurchAssembler !== 'undefined') ? new ChurchAssembler().disassemble(w) : '';
                this.output += `  PC=${i} (0x${(abstrLoc+i).toString(16).padStart(4,'0')}): 0x${w.toString(16).padStart(8,'0')}  ${disasm}\n`;
            }
        }
        this.output += '\nStep or Run to begin boot sequence with loaded data.\n';

        this.pc = 0;
        this.halted = false;
        this.running = false;
        this.bootComplete = false;
        this.mElevation = false;
        this.bootStep = 0;
        this.ledBits = 0; this.ledMode = 'boot';
        this.faultLog = [];
        this.stepCount = 0;
        this.callStack = [];
        this.sto = 0;

        this.emit('programLoaded', { addr: 0, length: hwBoot ? hwBoot.length : 0 });
        this.emit('stateChange', this.getState());
    }

    exportHardwareImage() {
        const NS_WORDS = 192;
        const CLIST_WORDS = 64;

        const nsWords = new Uint32Array(NS_WORDS);
        const nsEntries = Math.min(this.nsCount || 16, 64);
        for (let i = 0; i < nsEntries; i++) {
            const base = this.NS_TABLE_BASE + i * this.NS_ENTRY_WORDS;
            nsWords[i * 3 + 0] = this.memory[base + 0] >>> 0;
            nsWords[i * 3 + 1] = this.memory[base + 1] >>> 0;
            nsWords[i * 3 + 2] = this.memory[base + 2] >>> 0;
        }

        const clistWords = new Uint32Array(CLIST_WORDS);
        const abstrNSBase = this.NS_TABLE_BASE + 2 * this.NS_ENTRY_WORDS;
        const abstrLoc = this.memory[abstrNSBase] || (2 * this.SLOT_SIZE);
        const abstrW1 = this.memory[abstrNSBase + 1];
        const abstrParsed = this.parseNSWord1(abstrW1);
        const abstrAllocSize = abstrParsed.limit + 1;
        const abstrClistCount = abstrParsed.clistCount || 0;
        const abstrClistStart = abstrAllocSize - abstrClistCount;
        const clistBase = abstrLoc + abstrClistStart;
        for (let i = 0; i < Math.min(abstrClistCount, CLIST_WORDS); i++) {
            clistWords[i] = this.memory[clistBase + i] >>> 0;
        }

        return { namespace: nsWords, clist: clistWords };
    }

    run(maxSteps) {
        maxSteps = maxSteps || 10000;
        this.running = true;
        let steps = 0;
        while (this.running && !this.halted && this.bootComplete && steps < maxSteps) {
            const result = this.step();
            if (!result || !this.bootComplete) break;
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
            sto: this.sto,
            callStack: this.callStack.length,
            callFrames: this.callStack.map(f => ({ sz: f.sz, returnPC: f.returnPC, savedSTO: f.savedSTO, frameWord: f.frameWord })),
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
                word0_gt: '00000000', perms: '-------', gtSeq: 0, gtIndex: 0, gtType: 'NULL', gtTypeName: 'NULL',
                word1_location: 0,
                word2_limit_raw: 0, limitB: 0, limitF: 0, limit17: 0,
                word3_seals_raw: 0, sealGtSeq: 0, sealCRC: 0,
            };
        }
        const parsed = this.parseGT(cr.word0);
        const lim = this.parseNSWord1(cr.word2);
        const sealGtSeq = (cr.word3 >>> 25) & 0x7F;
        const sealCRC = cr.word3 & 0xFFFF;
        const permStr = (parsed.permissions.B ? 'B' : '-') +
                        (parsed.permissions.R ? 'R' : '-') +
                        (parsed.permissions.W ? 'W' : '-') +
                        (parsed.permissions.X ? 'X' : '-') +
                        (parsed.permissions.L ? 'L' : '-') +
                        (parsed.permissions.S ? 'S' : '-') +
                        (parsed.permissions.E ? 'E' : '-');
        return {
            index: idx, isNull: false, mBit: cr.m || 0,
            word0_gt: cr.word0.toString(16).toUpperCase().padStart(8, '0'),
            perms: permStr,
            gtSeq: parsed.gt_seq,
            gtIndex: parsed.index,
            gtType: parsed.type,
            gtTypeName: parsed.typeName,
            word1_location: cr.word1,
            word2_limit_raw: cr.word2,
            limitB: parsed.permissions.B,
            limitF: lim.f,
            limit17: lim.limit,
            word3_seals_raw: cr.word3,
            sealGtSeq: sealGtSeq,
            sealCRC: sealCRC,
        };
    }

    saveToNamespace(label, words, perms, gtType) {
        perms = perms || {R:0,W:0,X:1,L:0,S:0,E:0};
        gtType = (gtType !== undefined && gtType !== null) ? gtType : 1;
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
        gtType = (gtType !== undefined && gtType !== null) ? gtType : 1;
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
