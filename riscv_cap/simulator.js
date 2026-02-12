class RiscVCapSimulator {
    constructor() {
        this._listeners = {};
        this.reset();
    }

    reset() {
        this.x = new Array(32).fill(0);
        this.pc = 0;
        this.cr = [];
        for (let i = 0; i < 16; i++) {
            this.cr[i] = { word0: 0, word1: 0, word2: 0, word3: 0 };
        }
        this.memory = new Uint8Array(65536);
        this.namespaceTable = [];
        this.running = false;
        this.halted = false;
        this.stepCount = 0;
        this.output = '';
        this.breakpoints = new Set();
        this.callStack = [];
        this.callStackMax = 256;
        this.stackSpace = true;
        this.stackFrames = false;
        this.threadTable = {};
        this.bootComplete = false;

        this._initNamespaceTable();
        this._bootSequence();
        this.emit('reset', {});
        this.emit('stateChange', this.getState());
    }

    _initNamespaceTable() {
        this.namespaceTable = [];
        const defaults = [
            { location: 0x00000000, limit: 0x0000FFFF },
            { location: 0x00000000, limit: 0x00003FFF },
            { location: 0x00004000, limit: 0x00007FFF },
            { location: 0x00008000, limit: 0x000000FF },
        ];
        for (let i = 0; i < defaults.length; i++) {
            const d = defaults[i];
            this.namespaceTable[i] = {
                location: d.location,
                limit: d.limit,
                versionSeals: this.makeVersionSeals(0, d.location, d.limit),
                gBit: 0,
            };
        }
    }

    _bootSequence() {
        for (let i = 0; i < 32; i++) this.x[i] = 0;
        this.pc = 0;
        for (let i = 0; i < 16; i++) {
            this.cr[i] = { word0: 0, word1: 0, word2: 0, word3: 0 };
        }

        const permM = this.getPermBits({ R:0,W:0,X:0,L:0,S:0,E:0,B:0,M:1,F:0,G:0 });
        this.cr[15].word0 = this.createGT(0, 0, { R:0,W:0,X:0,L:0,S:0,E:0,B:0,M:1,F:0,G:0 }, 3);

        this.cr[8].word0 = this.createGT(0, 3, { R:0,W:0,X:0,L:0,S:0,E:0,B:0,M:1,F:0,G:0 }, 3);

        this.cr[7].word0 = this.createGT(0, 0, { R:0,W:0,X:0,L:0,S:0,E:1,B:0,M:1,F:0,G:0 }, 3);
        this.cr[6].word0 = this.createGT(0, 1, { R:0,W:0,X:0,L:1,S:1,E:0,B:0,M:0,F:0,G:0 }, 3);

        this.bootComplete = true;
    }

    // ===== GT Helper Methods =====

    parseGT(gt32) {
        gt32 = gt32 >>> 0;
        const version = (gt32 >>> 27) & 0x1F;
        const index = (gt32 >>> 12) & 0x7FFF;
        const permBits = (gt32 >>> 2) & 0x3FF;
        const type = gt32 & 0x3;

        return {
            version,
            index,
            permissions: {
                R: (permBits >>> 0) & 1,
                W: (permBits >>> 1) & 1,
                X: (permBits >>> 2) & 1,
                L: (permBits >>> 3) & 1,
                S: (permBits >>> 4) & 1,
                E: (permBits >>> 5) & 1,
                B: (permBits >>> 6) & 1,
                M: (permBits >>> 7) & 1,
                F: (permBits >>> 8) & 1,
                G: (permBits >>> 9) & 1,
            },
            type,
            typeName: this.getTypeName(type),
        };
    }

    createGT(version, index, perms, type) {
        const v = ((version & 0x1F) << 27) >>> 0;
        const i = ((index & 0x7FFF) << 12) >>> 0;
        const p = (this.getPermBits(perms) << 2) >>> 0;
        const t = type & 0x3;
        return (v | i | p | t) >>> 0;
    }

    getPermBits(permsObj) {
        let bits = 0;
        if (permsObj.R) bits |= (1 << 0);
        if (permsObj.W) bits |= (1 << 1);
        if (permsObj.X) bits |= (1 << 2);
        if (permsObj.L) bits |= (1 << 3);
        if (permsObj.S) bits |= (1 << 4);
        if (permsObj.E) bits |= (1 << 5);
        if (permsObj.B) bits |= (1 << 6);
        if (permsObj.M) bits |= (1 << 7);
        if (permsObj.F) bits |= (1 << 8);
        if (permsObj.G) bits |= (1 << 9);
        return bits & 0x3FF;
    }

    checkPermission(gt, requiredPerm) {
        const parsed = this.parseGT(gt);
        return parsed.permissions[requiredPerm] === 1;
    }

    computeSeal(location, limit) {
        let h = 0x5A5A5A5A;
        h = ((h ^ location) * 0x01000193) >>> 0;
        h = ((h ^ limit) * 0x01000193) >>> 0;
        h = (h ^ (h >>> 16)) >>> 0;
        return h & 0x07FFFFFF;
    }

    makeVersionSeals(version, location, limit) {
        const seal = this.computeSeal(location, limit);
        return (((version & 0x1F) << 27) | (seal & 0x07FFFFFF)) >>> 0;
    }

    validateMAC(entry) {
        if (!entry) return false;
        const storedSeal = entry.versionSeals & 0x07FFFFFF;
        const computedSeal = this.computeSeal(entry.location, entry.limit);
        return storedSeal === computedSeal;
    }

    validateGT(gt) {
        const parsed = this.parseGT(gt);
        if (parsed.index >= this.namespaceTable.length) return false;
        const entry = this.namespaceTable[parsed.index];
        if (!entry) return false;
        const nsVersion = (entry.versionSeals >>> 27) & 0x1F;
        if (parsed.version !== nsVersion) return false;
        return this.validateMAC(entry);
    }

    mLoad(gt32, requiredPerm, destCR = null) {
        const parsed = this.parseGT(gt32);
        if (parsed.index >= this.namespaceTable.length) {
            return { ok: false, fault: 'BOUNDS', message: `namespace index ${parsed.index} out of bounds` };
        }
        const entry = this.namespaceTable[parsed.index];
        if (!entry) {
            return { ok: false, fault: 'BOUNDS', message: `namespace entry ${parsed.index} is null` };
        }
        const nsVersion = (entry.versionSeals >>> 27) & 0x1F;
        if (parsed.version !== nsVersion) {
            return { ok: false, fault: 'VERSION', message: `version mismatch: GT has ${parsed.version}, entry has ${nsVersion}` };
        }
        if (!this.validateMAC(entry)) {
            return { ok: false, fault: 'MAC', message: `MAC seal validation failed for namespace entry ${parsed.index}` };
        }
        if (requiredPerm !== null && !parsed.permissions[requiredPerm]) {
            return { ok: false, fault: 'PERMISSION', message: `lacks ${requiredPerm} permission` };
        }
        entry.gBit = 0;
        if (destCR !== null) {
            this._writeCR(destCR, gt32, entry);
        }
        return { ok: true, parsed, entry, index: parsed.index };
    }

    mLoadByIndex(index, destCR = null) {
        if (index >= this.namespaceTable.length) {
            return { ok: false, fault: 'BOUNDS', message: `namespace index ${index} out of bounds` };
        }
        const entry = this.namespaceTable[index];
        if (!entry) {
            return { ok: false, fault: 'BOUNDS', message: `namespace entry ${index} is null` };
        }
        if (!this.validateMAC(entry)) {
            return { ok: false, fault: 'MAC', message: `MAC seal validation failed for namespace entry ${index}` };
        }
        entry.gBit = 0;
        if (destCR !== null) {
            const version = (entry.versionSeals >>> 27) & 0x1F;
            const gt = this.createGT(version, index, { R:0,W:0,X:0,L:0,S:0,E:0,B:0,M:0,F:0,G:0 }, 0);
            this._writeCR(destCR, gt, entry);
        }
        return { ok: true, entry, index };
    }

    _writeCR(crIdx, gt32, entry) {
        this.cr[crIdx].word0 = gt32;
        this.cr[crIdx].word1 = entry.location >>> 0;
        this.cr[crIdx].word2 = entry.limit >>> 0;
        this.cr[crIdx].word3 = entry.versionSeals >>> 0;
        this._updateThreadShadow(crIdx);
    }

    _clearCR(crIdx) {
        this.cr[crIdx] = { word0: 0, word1: 0, word2: 0, word3: 0 };
        this._updateThreadShadow(crIdx);
    }

    _updateThreadShadow(crIdx) {
        const threadGT = this.cr[8].word0;
        if (threadGT === 0) return;
        const threadId = this.parseGT(threadGT).index;
        if (!this.threadTable[threadId]) {
            this.threadTable[threadId] = {
                x: new Array(32).fill(0),
                cr: [],
                pc: this.pc,
            };
            for (let i = 0; i < 16; i++) {
                this.threadTable[threadId].cr[i] = { word0: 0, word1: 0, word2: 0, word3: 0 };
            }
        }
        this.threadTable[threadId].cr[crIdx] = { ...this.cr[crIdx] };
    }

    getTypeName(type) {
        const names = ['Inform', 'Outform', 'Literal', 'Abstract'];
        return names[type & 0x3];
    }

    // ===== Memory Access Methods =====

    readByte(addr) {
        addr = addr & 0xFFFF;
        return this.memory[addr];
    }

    writeByte(addr, value) {
        addr = addr & 0xFFFF;
        this.memory[addr] = value & 0xFF;
    }

    readHalf(addr) {
        addr = addr & 0xFFFF;
        return (this.memory[addr] | (this.memory[(addr + 1) & 0xFFFF] << 8)) & 0xFFFF;
    }

    writeHalf(addr, value) {
        addr = addr & 0xFFFF;
        this.memory[addr] = value & 0xFF;
        this.memory[(addr + 1) & 0xFFFF] = (value >>> 8) & 0xFF;
    }

    readWord(addr) {
        addr = addr & 0xFFFF;
        return (
            this.memory[addr] |
            (this.memory[(addr + 1) & 0xFFFF] << 8) |
            (this.memory[(addr + 2) & 0xFFFF] << 16) |
            (this.memory[(addr + 3) & 0xFFFF] << 24)
        ) >>> 0;
    }

    writeWord(addr, value) {
        addr = addr & 0xFFFF;
        value = value >>> 0;
        this.memory[addr] = value & 0xFF;
        this.memory[(addr + 1) & 0xFFFF] = (value >>> 8) & 0xFF;
        this.memory[(addr + 2) & 0xFFFF] = (value >>> 16) & 0xFF;
        this.memory[(addr + 3) & 0xFFFF] = (value >>> 24) & 0xFF;
    }

    // ===== Instruction Decoding =====

    decodeInstruction(instr) {
        instr = instr >>> 0;
        const opcode = instr & 0x7F;
        const rd = (instr >>> 7) & 0x1F;
        const funct3 = (instr >>> 12) & 0x7;
        const rs1 = (instr >>> 15) & 0x1F;
        const rs2 = (instr >>> 20) & 0x1F;
        const funct7 = (instr >>> 25) & 0x7F;

        let imm = 0;
        switch (opcode) {
            case 0x13: case 0x03: case 0x67: case 0x73:
                imm = (instr >> 20);
                break;
            case 0x23:
                imm = ((instr >>> 7) & 0x1F) | (((instr >> 25) & 0x7F) << 5);
                break;
            case 0x63: {
                const b11 = (instr >>> 7) & 1;
                const b4_1 = (instr >>> 8) & 0xF;
                const b10_5 = (instr >>> 25) & 0x3F;
                const b12 = (instr >>> 31) & 1;
                imm = (b4_1 << 1) | (b10_5 << 5) | (b11 << 11) | (b12 << 12);
                if (b12) imm |= 0xFFFFE000;
                break;
            }
            case 0x37: case 0x17:
                imm = instr & 0xFFFFF000;
                break;
            case 0x6F: {
                const j20 = (instr >>> 31) & 1;
                const j10_1 = (instr >>> 21) & 0x3FF;
                const j11 = (instr >>> 20) & 1;
                const j19_12 = (instr >>> 12) & 0xFF;
                imm = (j10_1 << 1) | (j11 << 11) | (j19_12 << 12) | (j20 << 20);
                if (j20) imm |= 0xFFE00000;
                break;
            }
        }

        return { opcode, rd, funct3, rs1, rs2, funct7, imm, raw: instr };
    }

    // ===== Sign extension helper =====
    _signExtend(value, bits) {
        const shift = 32 - bits;
        return (value << shift) >> shift;
    }

    // ===== Instruction Execution =====

    executeInstruction(instr) {
        const d = this.decodeInstruction(instr);
        const { opcode, rd, funct3, rs1, rs2, funct7 } = d;
        let imm = d.imm;

        const setRd = (val) => {
            if (rd !== 0) this.x[rd] = val >>> 0;
        };

        const rs1v = this.x[rs1] >>> 0;
        const rs2v = this.x[rs2] >>> 0;
        const rs1s = this.x[rs1] | 0;
        const rs2s = this.x[rs2] | 0;

        switch (opcode) {
            // R-type
            case 0x33: {
                switch (funct3) {
                    case 0x0:
                        if (funct7 === 0x20) setRd((rs1v - rs2v) >>> 0); // SUB
                        else setRd((rs1v + rs2v) >>> 0); // ADD
                        break;
                    case 0x1: setRd((rs1v << (rs2v & 0x1F)) >>> 0); break; // SLL
                    case 0x2: setRd(rs1s < rs2s ? 1 : 0); break; // SLT
                    case 0x3: setRd(rs1v < rs2v ? 1 : 0); break; // SLTU
                    case 0x4: setRd((rs1v ^ rs2v) >>> 0); break; // XOR
                    case 0x5:
                        if (funct7 === 0x20) setRd((rs1s >> (rs2v & 0x1F)) >>> 0); // SRA
                        else setRd((rs1v >>> (rs2v & 0x1F)) >>> 0); // SRL
                        break;
                    case 0x6: setRd((rs1v | rs2v) >>> 0); break; // OR
                    case 0x7: setRd((rs1v & rs2v) >>> 0); break; // AND
                    default:
                        this.fault('ILLEGAL', `Unknown R-type funct3=${funct3}`);
                        return;
                }
                this.pc = (this.pc + 4) >>> 0;
                break;
            }

            // I-type arithmetic
            case 0x13: {
                const immVal = imm | 0;
                const immU = imm >>> 0;
                const shamt = rs2;
                switch (funct3) {
                    case 0x0: setRd((rs1v + immVal) >>> 0); break; // ADDI
                    case 0x2: setRd(rs1s < immVal ? 1 : 0); break; // SLTI
                    case 0x3: setRd(rs1v < (immVal >>> 0) ? 1 : 0); break; // SLTIU
                    case 0x4: setRd((rs1v ^ immVal) >>> 0); break; // XORI
                    case 0x6: setRd((rs1v | immVal) >>> 0); break; // ORI
                    case 0x7: setRd((rs1v & immVal) >>> 0); break; // ANDI
                    case 0x1: setRd((rs1v << shamt) >>> 0); break; // SLLI
                    case 0x5:
                        if (funct7 === 0x20) setRd((rs1s >> shamt) >>> 0); // SRAI
                        else setRd((rs1v >>> shamt) >>> 0); // SRLI
                        break;
                    default:
                        this.fault('ILLEGAL', `Unknown I-type funct3=${funct3}`);
                        return;
                }
                this.pc = (this.pc + 4) >>> 0;
                break;
            }

            // Load
            case 0x03: {
                const addr = ((rs1v + (imm | 0)) & 0xFFFF) >>> 0;
                switch (funct3) {
                    case 0x0: { // LB
                        let val = this.readByte(addr);
                        if (val & 0x80) val |= 0xFFFFFF00;
                        setRd(val >>> 0);
                        break;
                    }
                    case 0x1: { // LH
                        let val = this.readHalf(addr);
                        if (val & 0x8000) val |= 0xFFFF0000;
                        setRd(val >>> 0);
                        break;
                    }
                    case 0x2: // LW
                        setRd(this.readWord(addr));
                        break;
                    case 0x4: // LBU
                        setRd(this.readByte(addr));
                        break;
                    case 0x5: // LHU
                        setRd(this.readHalf(addr));
                        break;
                    default:
                        this.fault('ILLEGAL', `Unknown load funct3=${funct3}`);
                        return;
                }
                this.pc = (this.pc + 4) >>> 0;
                break;
            }

            // Store
            case 0x23: {
                const sImm = d.imm | 0;
                const addr = ((rs1v + sImm) & 0xFFFF) >>> 0;
                switch (funct3) {
                    case 0x0: this.writeByte(addr, rs2v); break; // SB
                    case 0x1: this.writeHalf(addr, rs2v); break; // SH
                    case 0x2: this.writeWord(addr, rs2v); break; // SW
                    default:
                        this.fault('ILLEGAL', `Unknown store funct3=${funct3}`);
                        return;
                }
                this.pc = (this.pc + 4) >>> 0;
                break;
            }

            // Branch
            case 0x63: {
                let taken = false;
                switch (funct3) {
                    case 0x0: taken = (rs1v === rs2v); break; // BEQ
                    case 0x1: taken = (rs1v !== rs2v); break; // BNE
                    case 0x4: taken = (rs1s < rs2s); break; // BLT
                    case 0x5: taken = (rs1s >= rs2s); break; // BGE
                    case 0x6: taken = (rs1v < rs2v); break; // BLTU
                    case 0x7: taken = (rs1v >= rs2v); break; // BGEU
                    default:
                        this.fault('ILLEGAL', `Unknown branch funct3=${funct3}`);
                        return;
                }
                if (taken) {
                    this.pc = (this.pc + (d.imm | 0)) >>> 0;
                } else {
                    this.pc = (this.pc + 4) >>> 0;
                }
                break;
            }

            // LUI
            case 0x37: {
                setRd(d.imm >>> 0);
                this.pc = (this.pc + 4) >>> 0;
                break;
            }

            // AUIPC
            case 0x17: {
                setRd((this.pc + (d.imm | 0)) >>> 0);
                this.pc = (this.pc + 4) >>> 0;
                break;
            }

            // JAL
            case 0x6F: {
                setRd((this.pc + 4) >>> 0);
                this.pc = (this.pc + (d.imm | 0)) >>> 0;
                break;
            }

            // JALR
            case 0x67: {
                const target = ((rs1v + (imm | 0)) & ~1) >>> 0;
                setRd((this.pc + 4) >>> 0);
                this.pc = target;
                break;
            }

            // SYSTEM
            case 0x73: {
                if (imm === 0) {
                    // ECALL - halt
                    this.halted = true;
                    this.running = false;
                    this.output += `[ECALL] Halt at PC=0x${this.pc.toString(16)}\n`;
                    this.emit('halt', { pc: this.pc, reason: 'ecall' });
                    this.emit('output', this.output);
                } else if (imm === 1) {
                    // EBREAK
                    this.running = false;
                    this.output += `[EBREAK] Breakpoint at PC=0x${this.pc.toString(16)}\n`;
                    this.emit('breakpoint', { pc: this.pc });
                    this.emit('output', this.output);
                }
                this.pc = (this.pc + 4) >>> 0;
                break;
            }

            // Church Capability Instructions
            case 0x0B: { // custom-0: RETURN, CHANGE, SWITCH
                this._executeChurchCustom0(d);
                break;
            }
            case 0x2B: { // custom-1: LOAD
                this._executeChurchLoad(d);
                break;
            }
            case 0x5B: { // custom-2: CALL
                this._executeChurchCall(d);
                break;
            }
            case 0x7B: { // custom-3: SAVE
                this._executeChurchSave(d);
                break;
            }

            default:
                this.fault('ILLEGAL', `Unknown opcode 0x${opcode.toString(16)} at PC=0x${this.pc.toString(16)}`);
                return;
        }

        this.x[0] = 0;
    }

    _executeChurchLoad(d) {
        const crDst = (d.raw >>> 9) & 0x7;
        const crSrc = (d.raw >>> 12) & 0x7;
        const index = (d.raw >>> 17) & 0x7FFF;

        const clistGT = this.cr[crSrc].word0;
        const clistResult = this.mLoad(clistGT, 'L');
        if (!clistResult.ok) {
            this.fault(clistResult.fault, `LOAD: CR${crSrc} C-List: ${clistResult.message}`);
            return;
        }
        const targetResult = this.mLoadByIndex(index);
        if (!targetResult.ok) {
            this.fault(targetResult.fault, `LOAD: target entry ${index}: ${targetResult.message}`);
            return;
        }
        const entry = targetResult.entry;
        const srcPerms = clistResult.parsed.permissions;
        const loadedGT = this.createGT(
            (entry.versionSeals >>> 27) & 0x1F,
            index,
            { R: srcPerms.R, W: srcPerms.W, X: srcPerms.X,
              L: srcPerms.L, S: srcPerms.S, E: srcPerms.E,
              B: srcPerms.B, M: 0, F: srcPerms.F, G: srcPerms.G },
            0
        );
        this._writeCR(crDst, loadedGT, entry);
        this.pc = (this.pc + 4) >>> 0;
        this.x[0] = 0;
    }

    _executeChurchSave(d) {
        const crSrcCap = (d.raw >>> 9) & 0x7;
        const crDstList = (d.raw >>> 12) & 0x7;
        const index = (d.raw >>> 17) & 0x7FFF;

        const clistGT = this.cr[crDstList].word0;
        const clistResult = this.mLoad(clistGT, 'S');
        if (!clistResult.ok) {
            this.fault(clistResult.fault, `SAVE: CR${crDstList} C-List: ${clistResult.message}`);
            return;
        }
        if (index >= 32768) {
            this.fault('BOUNDS', `SAVE: index ${index} out of bounds`);
            return;
        }
        while (this.namespaceTable.length <= index) {
            const emptySeal = this.makeVersionSeals(0, 0, 0);
            this.namespaceTable.push({ location: 0, limit: 0, versionSeals: emptySeal, gBit: 0 });
        }
        const srcCR = this.cr[crSrcCap];
        const loc = srcCR.word1 >>> 0;
        const lim = srcCR.word2 >>> 0;
        const existingVersion = (this.namespaceTable[index].versionSeals >>> 27) & 0x1F;
        this.namespaceTable[index] = {
            location: loc,
            limit: lim,
            versionSeals: this.makeVersionSeals(existingVersion, loc, lim),
            gBit: 0,
        };
        this.pc = (this.pc + 4) >>> 0;
        this.x[0] = 0;
    }

    _executeChurchCall(d) {
        const crSrc = (d.raw >>> 12) & 0x7;

        const targetGT = this.cr[crSrc].word0;
        const targetResult = this.mLoad(targetGT, 'E');
        if (!targetResult.ok) {
            this.fault(targetResult.fault, `CALL: CR${crSrc}: ${targetResult.message}`);
            return;
        }
        if (this.callStack.length >= this.callStackMax) {
            this.fault('STACK_OVERFLOW', `CALL: call stack full (max ${this.callStackMax} frames)`);
            return;
        }
        this.callStack.push({
            pc: this.pc,
            cr5: { ...this.cr[5] },
            cr6: { ...this.cr[6] },
            cr7: { ...this.cr[7] },
        });
        this.stackSpace = this.callStack.length < this.callStackMax;
        this.stackFrames = true;
        const parsed = targetResult.parsed;
        const nsResult = this.mLoadByIndex(parsed.index);
        if (!nsResult.ok) {
            this.fault(nsResult.fault, `CALL: namespace entry ${parsed.index}: ${nsResult.message}`);
            return;
        }
        const entry = nsResult.entry;
        const calleePerms = parsed.permissions;
        const cr6GT = this.createGT(
            parsed.version, parsed.index,
            { R:0, W:0, X:0, L: calleePerms.L, S: calleePerms.S,
              E:0, B:0, M:1, F:0, G:0 },
            3
        );
        this._writeCR(6, cr6GT, entry);
        const cr7GT = this.createGT(
            parsed.version, parsed.index,
            { R: calleePerms.R, W: calleePerms.W, X: calleePerms.X,
              L:0, S:0, E: calleePerms.E, B:0, M:1, F:0, G:0 },
            3
        );
        this._writeCR(7, cr7GT, entry);
        this.pc = entry.location >>> 0;
        this._clearCR(5);
        this.x[0] = 0;
    }

    _executeChurchCustom0(d) {
        const { funct3, rs2 } = d;
        const crSrc = rs2 & 0x7;
        const switchTarget = (d.raw >>> 22) & 0x7;

        switch (funct3) {
            case 0x0: { // RETURN
                if (this.callStack.length === 0) {
                    this.fault('RETURN', `RETURN: No saved context to restore`);
                    return;
                }
                const saved = this.callStack.pop();
                this.stackFrames = this.callStack.length > 0;
                this.stackSpace = true;
                const cr5Result = this.mLoad(saved.cr5.word0, null, 5);
                if (!cr5Result.ok) {
                    this._clearCR(5);
                }
                const cr6Parsed = this.parseGT(saved.cr6.word0);
                const cr6Perms = cr6Parsed.permissions;
                cr6Perms.M = 1;
                const cr6GT = this.createGT(cr6Parsed.version, cr6Parsed.index, cr6Perms, cr6Parsed.type);
                const cr6Result = this.mLoad(cr6GT, 'L', 6);
                if (!cr6Result.ok) {
                    this.fault(cr6Result.fault, `RETURN: CR6 restore: ${cr6Result.message}`);
                    return;
                }
                const cr7Result = this.mLoad(saved.cr7.word0, null, 7);
                if (!cr7Result.ok) {
                    this.fault(cr7Result.fault, `RETURN: CR7 restore: ${cr7Result.message}`);
                    return;
                }
                this.pc = (saved.pc + 4) >>> 0;
                break;
            }

            case 0x1: { // CHANGE
                const threadGT = this.cr[crSrc].word0;
                const changeResult = this.mLoad(threadGT, 'E');
                if (!changeResult.ok) {
                    this.fault(changeResult.fault, `CHANGE: CR${crSrc}: ${changeResult.message}`);
                    return;
                }
                const parsed = changeResult.parsed;
                const threadId = parsed.index;
                const currentThreadId = this.parseGT(this.cr[8].word0).index;
                if (!this.threadTable[currentThreadId]) {
                    this.threadTable[currentThreadId] = {
                        x: new Array(32).fill(0),
                        cr: [],
                        pc: 0,
                    };
                    for (let i = 0; i < 16; i++) {
                        this.threadTable[currentThreadId].cr[i] = { word0: 0, word1: 0, word2: 0, word3: 0 };
                    }
                }
                this.threadTable[currentThreadId].x = [...this.x];
                this.threadTable[currentThreadId].pc = (this.pc + 4) >>> 0;
                const target = this.threadTable[threadId];
                if (target) {
                    for (let i = 0; i < 32; i++) this.x[i] = target.x[i];
                    for (let i = 0; i <= 8; i++) {
                        const savedGT = target.cr[i] ? target.cr[i].word0 : 0;
                        if (savedGT !== 0) {
                            const crResult = this.mLoad(savedGT, null, i);
                            if (!crResult.ok) {
                                this._clearCR(i);
                            }
                        } else {
                            this._clearCR(i);
                        }
                    }
                    this.pc = target.pc;
                } else {
                    for (let i = 0; i < 32; i++) this.x[i] = 0;
                    for (let i = 0; i <= 8; i++) {
                        this._clearCR(i);
                    }
                    this._writeCR(8, threadGT, changeResult.entry);
                    const nsResult = this.mLoadByIndex(parsed.index);
                    if (nsResult.ok) {
                        this.pc = nsResult.entry.location >>> 0;
                    } else {
                        this.pc = 0;
                    }
                }
                break;
            }

            case 0x2: { // SWITCH
                const srcGT = this.cr[crSrc].word0;
                const switchResult = this.mLoad(srcGT, 'M');
                if (!switchResult.ok) {
                    this.fault(switchResult.fault, `SWITCH: CR${crSrc}: ${switchResult.message}`);
                    return;
                }
                const destIdx = 8 + switchTarget;
                if (destIdx > 15) {
                    this.fault('BOUNDS', `SWITCH: Invalid target register index ${destIdx}`);
                    return;
                }
                this._writeCR(destIdx, srcGT, switchResult.entry);
                this.pc = (this.pc + 4) >>> 0;
                break;
            }

            case 0x3: { // TPERM
                const rd = (d.raw >>> 7) & 0x1F;
                const crIdx = crSrc;
                const gt = this.cr[crIdx].word0;
                const parsed = this.parseGT(gt);
                const permBits = this.getPermBits(parsed.permissions) & 0x3FF;
                const valid = this.validateGT(gt) ? 1 : 0;
                const typeBits = parsed.type & 0x3;
                const result = ((typeBits & 0x3) << 13) |
                               ((valid & 0x1) << 12) |
                               ((this.stackSpace ? 1 : 0) << 11) |
                               ((this.stackFrames ? 1 : 0) << 10) |
                               (permBits & 0x3FF);
                if (rd !== 0) this.x[rd] = result >>> 0;
                this.pc = (this.pc + 4) >>> 0;
                break;
            }

            default:
                this.fault('ILLEGAL', `Unknown Church custom-0 funct3=${funct3}`);
                return;
        }

        this.x[0] = 0;
    }

    // ===== Disassembly =====

    disassemble(instr, pc) {
        const d = this.decodeInstruction(instr);
        const { opcode, rd, funct3, rs1, rs2, funct7 } = d;
        const imm = d.imm;
        const x = (r) => `x${r}`;

        switch (opcode) {
            case 0x33: {
                const ops = {
                    0x0: funct7 === 0x20 ? 'SUB' : 'ADD',
                    0x1: 'SLL', 0x2: 'SLT', 0x3: 'SLTU',
                    0x4: 'XOR',
                    0x5: funct7 === 0x20 ? 'SRA' : 'SRL',
                    0x6: 'OR', 0x7: 'AND',
                };
                const name = ops[funct3] || '???';
                return `${name} ${x(rd)}, ${x(rs1)}, ${x(rs2)}`;
            }
            case 0x13: {
                if (funct3 === 0x1) return `SLLI ${x(rd)}, ${x(rs1)}, ${rs2}`;
                if (funct3 === 0x5) {
                    const name = funct7 === 0x20 ? 'SRAI' : 'SRLI';
                    return `${name} ${x(rd)}, ${x(rs1)}, ${rs2}`;
                }
                const ops = { 0x0: 'ADDI', 0x2: 'SLTI', 0x3: 'SLTIU', 0x4: 'XORI', 0x6: 'ORI', 0x7: 'ANDI' };
                const name = ops[funct3] || '???';
                return `${name} ${x(rd)}, ${x(rs1)}, ${imm}`;
            }
            case 0x03: {
                const ops = { 0x0: 'LB', 0x1: 'LH', 0x2: 'LW', 0x4: 'LBU', 0x5: 'LHU' };
                return `${ops[funct3] || '???'} ${x(rd)}, ${imm}(${x(rs1)})`;
            }
            case 0x23: {
                const ops = { 0x0: 'SB', 0x1: 'SH', 0x2: 'SW' };
                return `${ops[funct3] || '???'} ${x(rs2)}, ${imm}(${x(rs1)})`;
            }
            case 0x63: {
                const ops = { 0x0: 'BEQ', 0x1: 'BNE', 0x4: 'BLT', 0x5: 'BGE', 0x6: 'BLTU', 0x7: 'BGEU' };
                const target = ((pc + (d.imm | 0)) >>> 0);
                return `${ops[funct3] || '???'} ${x(rs1)}, ${x(rs2)}, 0x${target.toString(16)}`;
            }
            case 0x37:
                return `LUI ${x(rd)}, 0x${((imm >>> 12) & 0xFFFFF).toString(16)}`;
            case 0x17:
                return `AUIPC ${x(rd)}, 0x${((imm >>> 12) & 0xFFFFF).toString(16)}`;
            case 0x6F: {
                const target = ((pc + (d.imm | 0)) >>> 0);
                return `JAL ${x(rd)}, 0x${target.toString(16)}`;
            }
            case 0x67:
                return `JALR ${x(rd)}, ${x(rs1)}, ${imm}`;
            case 0x73:
                if (imm === 0) return 'ECALL';
                if (imm === 1) return 'EBREAK';
                return `SYSTEM 0x${imm.toString(16)}`;
            case 0x0B: {
                const crSrc = rs2 & 0x7;
                switch (funct3) {
                    case 0: return `CAP.RETURN`;
                    case 1: return `CAP.CHANGE CR${crSrc}`;
                    case 2: {
                        const st = (d.raw >>> 22) & 0x7;
                        return `CAP.SWITCH CR${crSrc}, CR${8 + st}`;
                    }
                    case 3: return `CAP.TPERM ${x(rd)}, CR${crSrc}`;
                    default: return `C.??? funct3=${funct3}`;
                }
            }
            case 0x2B: {
                const crDst = (d.raw >>> 9) & 0x7;
                const crS = (d.raw >>> 12) & 0x7;
                const idx = (d.raw >>> 17) & 0x7FFF;
                return `CAP.LOAD CR${crDst}, CR${crS}, ${idx}`;
            }
            case 0x5B: {
                const crS = (d.raw >>> 12) & 0x7;
                return `CAP.CALL CR${crS}`;
            }
            case 0x7B: {
                const crSrcCap = (d.raw >>> 9) & 0x7;
                const crDstList = (d.raw >>> 12) & 0x7;
                const idx = (d.raw >>> 17) & 0x7FFF;
                return `CAP.SAVE CR${crSrcCap}, CR${crDstList}, ${idx}`;
            }
            default:
                return `??? (0x${instr.toString(16).padStart(8, '0')})`;
        }
    }

    disassembleAt(addr) {
        const instr = this.readWord(addr);
        return this.disassemble(instr, addr);
    }

    // ===== Core Methods =====

    step() {
        if (this.halted) return { executed: false, disasm: '[HALTED]' };

        const instrWord = this.readWord(this.pc);
        if (instrWord === 0) {
            this.halted = true;
            this.running = false;
            this.emit('halt', { pc: this.pc, reason: 'null instruction' });
            return { executed: false, disasm: '[NULL INSTRUCTION]' };
        }

        const disasm = this.disassemble(instrWord, this.pc);
        const pcBefore = this.pc;
        this.executeInstruction(instrWord);
        this.stepCount++;
        this.x[0] = 0;

        this.emit('step', { pc: pcBefore, disasm, stepCount: this.stepCount });
        this.emit('stateChange', this.getState());

        return { executed: true, disasm };
    }

    run(maxSteps = 10000) {
        this.running = true;
        let steps = 0;
        while (this.running && !this.halted && steps < maxSteps) {
            if (this.breakpoints.has(this.pc) && steps > 0) {
                this.running = false;
                this.output += `[BREAKPOINT] at PC=0x${this.pc.toString(16)}\n`;
                this.emit('breakpoint', { pc: this.pc });
                this.emit('output', this.output);
                break;
            }
            const result = this.step();
            if (!result.executed) break;
            steps++;
        }
        this.running = false;
        if (steps >= maxSteps) {
            this.output += `[MAX STEPS] Stopped after ${maxSteps} steps\n`;
            this.emit('output', this.output);
        }
        this.emit('stateChange', this.getState());
        return steps;
    }

    fault(type, message) {
        this.halted = true;
        this.running = false;
        const msg = `[FAULT:${type}] ${message}\n`;
        this.output += msg;
        this.emit('fault', { type, message, pc: this.pc });
        this.emit('output', this.output);
    }

    loadProgram(bytes) {
        if (bytes instanceof Uint8Array) {
            for (let i = 0; i < bytes.length && i < this.memory.length; i++) {
                this.memory[i] = bytes[i];
            }
        } else if (Array.isArray(bytes)) {
            for (let i = 0; i < bytes.length && i < this.memory.length; i++) {
                this.memory[i] = bytes[i] & 0xFF;
            }
        }
        this.pc = 0;
        this.halted = false;
        this.running = false;
        this.stepCount = 0;
        this.output = '';
        this.emit('stateChange', this.getState());
    }

    getState() {
        return {
            x: [...this.x],
            pc: this.pc,
            cr: this.cr.map(c => ({ ...c })),
            running: this.running,
            halted: this.halted,
            stepCount: this.stepCount,
            output: this.output,
            namespaceTable: this.namespaceTable.map(e => ({ ...e })),
            bootComplete: this.bootComplete,
            stackSpace: this.stackSpace,
            stackFrames: this.stackFrames,
            callStackDepth: this.callStack.length,
            callStackMax: this.callStackMax,
            gcResults: this.gcResults || null,
        };
    }

    exportState() {
        return JSON.stringify({
            x: [...this.x],
            pc: this.pc,
            cr: this.cr.map(c => ({ ...c })),
            memory: Array.from(this.memory),
            namespaceTable: this.namespaceTable.map(e => ({ ...e })),
            running: this.running,
            halted: this.halted,
            stepCount: this.stepCount,
            output: this.output,
            breakpoints: Array.from(this.breakpoints),
            history: this.history.map(h => ({
                pc: h.pc,
                cr6: { ...h.cr6 },
                cr7: { ...h.cr7 },
                x: [...h.x],
            })),
        });
    }

    importState(stateStr) {
        const state = typeof stateStr === 'string' ? JSON.parse(stateStr) : stateStr;
        this.x = state.x.map(v => v >>> 0);
        this.x[0] = 0;
        this.pc = state.pc >>> 0;
        this.cr = state.cr.map(c => ({
            word0: c.word0 >>> 0,
            word1: c.word1 >>> 0,
            word2: c.word2 >>> 0,
            word3: c.word3 >>> 0,
        }));
        if (state.memory) {
            this.memory = new Uint8Array(65536);
            for (let i = 0; i < state.memory.length && i < 65536; i++) {
                this.memory[i] = state.memory[i];
            }
        }
        this.namespaceTable = (state.namespaceTable || []).map(e => ({
            location: e.location,
            limit: e.limit,
            versionSeals: e.versionSeals,
            gBit: e.gBit || 0,
        }));
        this.running = state.running || false;
        this.halted = state.halted || false;
        this.stepCount = state.stepCount || 0;
        this.output = state.output || '';
        this.breakpoints = new Set(state.breakpoints || []);
        this.history = (state.history || []).map(h => ({
            pc: h.pc,
            cr6: { ...h.cr6 },
            cr7: { ...h.cr7 },
            x: [...h.x],
        }));
        this.emit('stateChange', this.getState());
    }

    // ===== Garbage Collection (Mark-Scan-Sweep) =====

    gcMark() {
        let marked = 0;
        for (let i = 0; i < this.namespaceTable.length; i++) {
            const entry = this.namespaceTable[i];
            if (entry && (entry.location !== 0 || entry.limit !== 0)) {
                const vs = entry.versionSeals;
                const version = (vs >>> 27) & 0x1F;
                entry.versionSeals = this.makeVersionSeals(version, entry.location, entry.limit);
                entry.gBit = 1;
                marked++;
            }
        }
        this.gcResults = this.gcResults || { marked: 0, scanned: 0, garbage: [] };
        this.gcResults.marked = marked;
        this.emit('gc', { phase: 'mark', marked });
        this.emit('stateChange', this.getState());
        return marked;
    }

    gcScan() {
        let scanned = 0;
        const reachable = new Set();

        for (let i = 0; i < 16; i++) {
            const gt = this.cr[i].word0;
            const parsed = this.parseGT(gt);
            if (parsed.index < this.namespaceTable.length && this.namespaceTable[parsed.index]) {
                const entry = this.namespaceTable[parsed.index];
                if (this.validateMAC(entry)) {
                    reachable.add(parsed.index);
                }
            }
        }

        for (const frame of this.callStack) {
            for (const crKey of ['cr5', 'cr6', 'cr7']) {
                const cr = frame[crKey];
                if (cr) {
                    const parsed = this.parseGT(cr.word0);
                    if (parsed.index < this.namespaceTable.length && this.namespaceTable[parsed.index]) {
                        reachable.add(parsed.index);
                    }
                }
            }
        }

        for (const threadId in this.threadTable) {
            const thread = this.threadTable[threadId];
            if (thread && thread.cr) {
                for (let i = 0; i < thread.cr.length; i++) {
                    const cr = thread.cr[i];
                    if (cr) {
                        const parsed = this.parseGT(cr.word0);
                        if (parsed.index < this.namespaceTable.length && this.namespaceTable[parsed.index]) {
                            reachable.add(parsed.index);
                        }
                    }
                }
            }
        }

        for (const idx of reachable) {
            const entry = this.namespaceTable[idx];
            if (entry && entry.gBit === 1) {
                entry.gBit = 0;
                scanned++;
            }
        }

        this.gcResults = this.gcResults || { marked: 0, scanned: 0, garbage: [] };
        this.gcResults.scanned = scanned;
        this.emit('gc', { phase: 'scan', scanned });
        this.emit('stateChange', this.getState());
        return scanned;
    }

    gcSweep() {
        const garbage = [];
        for (let i = 0; i < this.namespaceTable.length; i++) {
            const entry = this.namespaceTable[i];
            if (entry && entry.gBit === 1) {
                garbage.push({
                    index: i,
                    location: entry.location,
                    limit: entry.limit,
                });
                const version = ((entry.versionSeals >>> 27) & 0x1F);
                const newVersion = (version + 1) & 0x1F;
                entry.location = 0;
                entry.limit = 0;
                entry.versionSeals = this.makeVersionSeals(newVersion, 0, 0);
                entry.gBit = 0;
            }
        }
        this.gcResults = this.gcResults || { marked: 0, scanned: 0, garbage: [] };
        this.gcResults.garbage = garbage;
        this.emit('gc', { phase: 'sweep', garbage });
        this.emit('stateChange', this.getState());
        return garbage;
    }

    gcCycle() {
        const marked = this.gcMark();
        const scanned = this.gcScan();
        const garbage = this.gcSweep();
        const results = { marked, scanned, garbage };
        this.gcResults = results;
        this.emit('gc', { phase: 'complete', results });
        this.emit('stateChange', this.getState());
        return results;
    }

    // ===== Event System =====

    on(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(callback);
    }

    emit(event, data) {
        const cbs = this._listeners[event];
        if (cbs) {
            for (const cb of cbs) {
                try { cb(data); } catch (e) { console.error(`Event '${event}' handler error:`, e); }
            }
        }
    }
}

if (typeof window !== 'undefined') {
    window.RiscVCapSimulator = RiscVCapSimulator;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RiscVCapSimulator };
}
