class ChurchSimulator {
    constructor() {
        this._listeners = {};
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
            this.cr[i] = { word0: 0, word1: 0, word2: 0, word3: 0 };
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

        this.memory = new Uint32Array(4096);
        this.namespaceTable = [];
        this.bootComplete = false;

        this._initNamespaceTable();
        this._bootSequence();
        this.emit('reset', {});
        this.emit('stateChange', this.getState());
    }

    _initNamespaceTable() {
        this.namespaceTable = [];
        const abstractions = [
            { funcId: 'Boot',       perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { funcId: 'Threads',    perms: {R:0,W:0,X:0,L:1,S:1,E:1}, chainable: false },
            { funcId: 'Lambda',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { funcId: 'SlideRule',  perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: true },
            { funcId: 'Abacus',     perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: true },
            { funcId: 'Constants',  perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false },
            { funcId: 'Stack',      perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: true },
            { funcId: 'SUCC',       perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { funcId: 'PRED',       perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { funcId: 'ADD',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { funcId: 'SUB',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { funcId: 'MUL',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { funcId: 'DIV',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { funcId: 'POW',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { funcId: 'SQRT',       perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { funcId: 'LOG',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { funcId: 'EXP',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { funcId: 'ISZERO',     perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { funcId: 'LEQ',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { funcId: 'TRUE',       perms: {R:0,W:0,X:0,L:1,S:0,E:0}, chainable: false },
            { funcId: 'FALSE',      perms: {R:0,W:0,X:0,L:1,S:0,E:0}, chainable: false },
            { funcId: 'PAIR',       perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { funcId: 'FST',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
            { funcId: 'SND',        perms: {R:0,W:0,X:0,L:1,S:0,E:1}, chainable: false },
        ];
        for (let i = 0; i < abstractions.length; i++) {
            const a = abstractions[i];
            const loc = i * 0x100;
            const lim = loc + 0xFF;
            this.namespaceTable[i] = {
                location: loc,
                limit: lim,
                versionSeals: this.makeVersionSeals(0, loc, lim),
                gBit: 0,
                funcId: a.funcId,
                entryPerms: a.perms,
                gtType: 0,
                bindFlag: 1,
                chainable: a.chainable || false,
            };
        }
    }

    _bootSequence() {
        for (let i = 0; i < 16; i++) {
            this.cr[i] = { word0: 0, word1: 0, word2: 0, word3: 0 };
            this.dr[i] = 0;
        }
        this.pc = 0;

        const bootEntry = this.namespaceTable[0];
        const threadEntry = this.namespaceTable[1];

        const gt15 = this.createGT(0, 0, {R:0,W:0,X:0,L:1,S:0,E:1}, 0);
        this._writeCR(15, gt15, bootEntry);

        const gt8 = this.createGT(0, 1, {R:0,W:0,X:0,L:1,S:1,E:0}, 0);
        this._writeCR(8, gt8, threadEntry);

        const gt7 = this.createGT(0, 0, {R:0,W:0,X:0,L:0,S:0,E:1}, 0);
        this._writeCR(7, gt7, bootEntry);

        const gt6 = this.createGT(0, 1, {R:0,W:0,X:0,L:1,S:1,E:0}, 0);
        this._writeCR(6, gt6, threadEntry);

        this.bootComplete = true;
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

    computeSeal(location, limit) {
        let h = 0x5A5A5A5A;
        h = ((h ^ location) * 0x01000193) >>> 0;
        h = ((h ^ limit) * 0x01000193) >>> 0;
        h = (h ^ (h >>> 16)) >>> 0;
        return h & 0x01FFFFFF;
    }

    makeVersionSeals(version, location, limit) {
        const seal = this.computeSeal(location, limit);
        return (((version & 0x7F) << 25) | (seal & 0x01FFFFFF)) >>> 0;
    }

    validateMAC(entry) {
        if (!entry) return false;
        const storedSeal = entry.versionSeals & 0x01FFFFFF;
        return storedSeal === this.computeSeal(entry.location, entry.limit);
    }

    mLoad(gt32, requiredPerm) {
        const parsed = this.parseGT(gt32);
        if (parsed.index >= this.namespaceTable.length) {
            return { ok: false, fault: 'BOUNDS', message: `namespace index ${parsed.index} out of bounds` };
        }
        const entry = this.namespaceTable[parsed.index];
        if (!entry) {
            return { ok: false, fault: 'BOUNDS', message: `namespace entry ${parsed.index} is null` };
        }
        const nsVersion = (entry.versionSeals >>> 25) & 0x7F;
        if (parsed.version !== nsVersion) {
            return { ok: false, fault: 'VERSION', message: `version mismatch: GT v${parsed.version}, entry v${nsVersion}` };
        }
        if (!this.validateMAC(entry)) {
            return { ok: false, fault: 'SEAL', message: `FNV seal validation failed for entry ${parsed.index}` };
        }
        if (requiredPerm !== null && !parsed.permissions[requiredPerm]) {
            return { ok: false, fault: 'PERMISSION', message: `lacks ${requiredPerm} permission` };
        }
        entry.gBit = 0;
        return { ok: true, parsed, entry, index: parsed.index };
    }

    _writeCR(crIdx, gt32, entry) {
        this.cr[crIdx].word0 = gt32;
        this.cr[crIdx].word1 = entry.location >>> 0;
        this.cr[crIdx].word2 = entry.limit >>> 0;
        this.cr[crIdx].word3 = entry.versionSeals >>> 0;
    }

    _clearCR(crIdx) {
        this.cr[crIdx] = { word0: 0, word1: 0, word2: 0, word3: 0 };
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
        const names = ['LOAD','SAVE','CALL','RETURN','CHANGE','SWITCH','TPERM','LAMBDA','ELOADCALL','XLOADLAMBDA'];
        return names[code] || '???';
    }

    decodeInstruction(instr) {
        instr = instr >>> 0;
        return {
            opcode: (instr >>> 28) & 0xF,
            cond:   (instr >>> 24) & 0xF,
            crDst:  (instr >>> 20) & 0xF,
            crSrc:  (instr >>> 16) & 0xF,
            imm:    instr & 0xFFFF,
            raw:    instr,
        };
    }

    encodeInstruction(opcode, cond, crDst, crSrc, imm) {
        return (
            ((opcode & 0xF) << 28) |
            ((cond & 0xF) << 24) |
            ((crDst & 0xF) << 20) |
            ((crSrc & 0xF) << 16) |
            (imm & 0xFFFF)
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
        if (targetIdx >= this.namespaceTable.length) {
            this.fault('BOUNDS', `LOAD: namespace index ${targetIdx} out of bounds`);
            return null;
        }
        const entry = this.namespaceTable[targetIdx];
        if (!entry) {
            this.fault('BOUNDS', `LOAD: entry ${targetIdx} is null`);
            return null;
        }
        if (!this.validateMAC(entry)) {
            this.fault('SEAL', `LOAD: entry ${targetIdx} seal failed`);
            return null;
        }
        const version = (entry.versionSeals >>> 25) & 0x7F;
        const perms = entry.entryPerms || {R:0,W:0,X:0,L:0,S:0,E:0};
        const gt = this.createGT(version, targetIdx, perms, entry.gtType || 0);
        this._writeCR(d.crDst, gt, entry);
        const desc = `LOAD CR${d.crDst}, [CR${d.crSrc} + ${targetIdx}] → ${entry.funcId || 'entry_'+targetIdx}`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._loadPipeline(d, entry) };
    }

    _execSave(d) {
        const srcGT = this.cr[d.crDst].word0;
        if (srcGT === 0) {
            this.fault('NULL_CAP', `SAVE: CR${d.crDst} is NULL`);
            return null;
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
        if (targetIdx >= this.namespaceTable.length) {
            const parsed = this.parseGT(srcGT);
            const entry = {
                location: targetIdx * 0x100,
                limit: targetIdx * 0x100 + 0xFF,
                versionSeals: this.makeVersionSeals(0, targetIdx * 0x100, targetIdx * 0x100 + 0xFF),
                gBit: 0,
                funcId: `saved_${targetIdx}`,
                entryPerms: parsed.permissions,
                gtType: parsed.type,
                bindFlag: 1,
            };
            while (this.namespaceTable.length <= targetIdx) {
                this.namespaceTable.push(null);
            }
            this.namespaceTable[targetIdx] = entry;
        }
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

        this.callStack.push({
            returnPC: this.pc + 1,
            savedCRs: this.cr.map(c => ({...c})),
            savedDRs: [...this.dr],
            savedFlags: {...this.flags},
        });

        const entry = check.entry;
        const desc = `CALL CR${d.crDst} → ${entry.funcId || 'abstraction'}`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._callPipeline(d, entry) };
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
        if (targetIdx >= this.namespaceTable.length) {
            this.fault('BOUNDS', `CHANGE: index ${targetIdx} out of bounds`);
            return null;
        }
        const entry = this.namespaceTable[targetIdx];
        if (!entry) {
            this.fault('BOUNDS', `CHANGE: entry ${targetIdx} is null`);
            return null;
        }
        const version = (entry.versionSeals >>> 25) & 0x7F;
        const perms = entry.entryPerms || {R:0,W:0,X:0,L:0,S:0,E:0};
        const gt = this.createGT(version, targetIdx, perms, entry.gtType || 0);
        this._writeCR(d.crDst, gt, entry);
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
        const check = this.mLoad(targetGT, 'E');
        if (!check.ok) {
            this.fault(check.fault, `LAMBDA: CR${crIdx}: ${check.message}`);
            return null;
        }

        const parsed = this.parseGT(targetGT);
        const hasL = parsed.permissions.L === 1;
        const hasS = parsed.permissions.S === 1;
        const hasE = parsed.permissions.E === 1;

        if (hasL && !hasS && !hasE) {
            this.fault('DOMAIN_PURITY', `LAMBDA: CR${crIdx} has Turing permissions (L without E)`);
            return null;
        }

        const entry = check.entry;
        const desc = `LAMBDA CR${crIdx} → ${entry.funcId || 'reduction'}`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._lambdaPipeline(d, entry) };
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
        if (targetIdx >= this.namespaceTable.length) {
            this.fault('BOUNDS', `ELOADCALL: namespace index ${targetIdx} out of bounds`);
            return null;
        }
        const entry = this.namespaceTable[targetIdx];
        if (!entry) {
            this.fault('BOUNDS', `ELOADCALL: entry ${targetIdx} is null`);
            return null;
        }
        if (!this.validateMAC(entry)) {
            this.fault('SEAL', `ELOADCALL: entry ${targetIdx} seal failed`);
            return null;
        }

        const version = (entry.versionSeals >>> 25) & 0x7F;
        const perms = entry.entryPerms || {R:0,W:0,X:0,L:0,S:0,E:0};
        const gt = this.createGT(version, targetIdx, perms, entry.gtType || 0);
        this._writeCR(d.crDst, gt, entry);

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

        const desc = `ELOADCALL CR${d.crDst}, [CR${d.crSrc} + ${targetIdx}] → ${entry.funcId || 'abstraction'} (LOAD+TPERM+CALL)`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._eloadcallPipeline(d, entry) };
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
        if (slotIdx >= this.namespaceTable.length) {
            this.fault('BOUNDS', `XLOADLAMBDA: slot ${slotIdx} out of bounds`);
            return null;
        }
        const entry = this.namespaceTable[slotIdx];
        if (!entry) {
            this.fault('BOUNDS', `XLOADLAMBDA: slot ${slotIdx} is null`);
            return null;
        }
        if (!this.validateMAC(entry)) {
            this.fault('SEAL', `XLOADLAMBDA: slot ${slotIdx} seal failed`);
            return null;
        }

        const version = (entry.versionSeals >>> 25) & 0x7F;
        const perms = entry.entryPerms || {R:0,W:0,X:0,L:0,S:0,E:0};
        const gt = this.createGT(version, slotIdx, perms, entry.gtType || 0);
        this._writeCR(d.crDst, gt, entry);

        const parsed = this.parseGT(gt);
        if (!parsed.permissions.X && !parsed.permissions.E) {
            this.fault('PERMISSION', `XLOADLAMBDA TPERM: CR${d.crDst} lacks X and E`);
            return null;
        }

        const desc = `XLOADLAMBDA CR${d.crDst}, [CR${d.crSrc} + ${slotIdx}] → ${entry.funcId || 'slot'} (LOAD+TPERM+LAMBDA)`;
        this.output += desc + '\n';
        this.pc++;
        return { pc: this.pc - 1, instr: d, desc, pipeline: this._xloadlambdaPipeline(d, entry) };
    }

    _eloadcallPipeline(d, entry) {
        return [
            { stage: 'LOAD', desc: `Namespace lookup via CR${d.crSrc}, index ${d.imm}`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify E permission on ${entry.funcId || 'target'}`, perm: 'E', status: 'pass' },
            { stage: 'CALL', desc: `Enter ${entry.funcId || 'abstraction'}, save context`, status: 'pass' },
        ];
    }

    _xloadlambdaPipeline(d, entry) {
        return [
            { stage: 'LOAD', desc: `C-List slot lookup [CR${d.crSrc} + ${d.imm}]`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify X permission on ${entry.funcId || 'slot'}`, perm: 'X', status: 'pass' },
            { stage: 'LAMBDA', desc: `Church reduction via ${entry.funcId || 'lambda'}`, status: 'pass' },
        ];
    }

    _loadPipeline(d, entry) {
        return [
            { stage: 'LOAD', desc: `Namespace lookup via CR${d.crSrc}`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify L permission on CR${d.crSrc}`, perm: 'L', status: 'pass' },
            { stage: 'VALIDATE', desc: `FNV seal check on entry ${d.imm}`, status: 'pass' },
            { stage: 'WRITE', desc: `Write ${entry.funcId || 'entry'} to CR${d.crDst}`, status: 'pass' },
        ];
    }

    _callPipeline(d, entry) {
        return [
            { stage: 'LOAD', desc: `Read target GT from CR${d.crDst}`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify E permission on target`, perm: 'E', status: 'pass' },
            { stage: 'CALL', desc: `Enter ${entry.funcId || 'abstraction'}, save context`, status: 'pass' },
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

    _lambdaPipeline(d, entry) {
        return [
            { stage: 'LOAD', desc: `Read CR${d.crDst} GT`, perm: 'L', status: 'pass' },
            { stage: 'TPERM', desc: `Verify E permission`, perm: 'E', status: 'pass' },
            { stage: 'LAMBDA', desc: `Church reduction via ${entry.funcId || 'lambda'}`, status: 'pass' },
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
        if (!cr || cr.word0 === 0) {
            return { index: idx, name: 'NULL', gt: '00000000', perms: '------', nsIndex: 0, version: 0, type: 'NULL' };
        }
        const parsed = this.parseGT(cr.word0);
        const entry = this.namespaceTable[parsed.index];
        const permStr = (parsed.permissions.R ? 'R' : '-') +
                        (parsed.permissions.W ? 'W' : '-') +
                        (parsed.permissions.X ? 'X' : '-') +
                        (parsed.permissions.L ? 'L' : '-') +
                        (parsed.permissions.S ? 'S' : '-') +
                        (parsed.permissions.E ? 'E' : '-');
        return {
            index: idx,
            name: entry ? entry.funcId : `ns[${parsed.index}]`,
            gt: cr.word0.toString(16).toUpperCase().padStart(8, '0'),
            perms: permStr,
            nsIndex: parsed.index,
            version: parsed.version,
            type: parsed.typeName,
            location: cr.word1,
            limit: cr.word2,
        };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChurchSimulator;
}
