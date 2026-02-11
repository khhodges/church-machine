class RiscVAssembler {
    constructor() {
        this.REGS = {};
        const abiNames = [
            'zero','ra','sp','gp','tp',
            't0','t1','t2','s0','s1',
            'a0','a1','a2','a3','a4','a5','a6','a7',
            's2','s3','s4','s5','s6','s7','s8','s9','s10','s11',
            't3','t4','t5','t6'
        ];
        for (let i = 0; i < 32; i++) {
            this.REGS['x' + i] = i;
            this.REGS[abiNames[i]] = i;
        }
        this.REGS['fp'] = 8;
    }

    _parseReg(s) {
        if (!s) return -1;
        const r = this.REGS[s.toLowerCase().trim()];
        return r !== undefined ? r : -1;
    }

    _parseCR(s) {
        if (!s) return -1;
        const t = s.toLowerCase().trim();
        const m = t.match(/^(?:cr|c)(\d+)$/);
        if (!m) return -1;
        const n = parseInt(m[1]);
        return (n >= 0 && n <= 7) ? n : -1;
    }

    _parseImm(s, labels, pc) {
        if (!s) return NaN;
        s = s.trim();
        if (labels && labels.hasOwnProperty(s)) {
            return labels[s];
        }
        const neg = s.startsWith('-');
        const abs = neg ? s.slice(1).trim() : s;
        let val;
        if (abs.startsWith('0x') || abs.startsWith('0X')) {
            val = parseInt(abs, 16);
        } else if (abs.startsWith('0b') || abs.startsWith('0B')) {
            val = parseInt(abs.slice(2), 2);
        } else {
            val = parseInt(abs, 10);
        }
        return neg ? -val : val;
    }

    _splitArgs(argStr) {
        const args = [];
        let current = '';
        let parenDepth = 0;
        for (let i = 0; i < argStr.length; i++) {
            const ch = argStr[i];
            if (ch === '(') { parenDepth++; current += ch; }
            else if (ch === ')') { parenDepth--; current += ch; }
            else if (ch === ',' && parenDepth === 0) {
                args.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        if (current.trim()) args.push(current.trim());
        return args;
    }

    _parseMemOperand(s) {
        const m = s.match(/^(-?\s*(?:0[xXbB])?[\da-fA-F]+)\s*\(\s*(\w+)\s*\)$/);
        if (!m) {
            const m2 = s.match(/^\(\s*(\w+)\s*\)$/);
            if (m2) return { offset: 0, reg: m2[1] };
            return null;
        }
        return { offset: m[1].replace(/\s/g, ''), reg: m[2] };
    }

    _parseMemOperandWithLabel(s, labels, pc) {
        const m = s.match(/^([^\(]+)\(\s*(\w+)\s*\)$/);
        if (!m) {
            const m2 = s.match(/^\(\s*(\w+)\s*\)$/);
            if (m2) return { offset: 0, reg: m2[1] };
            return null;
        }
        const offStr = m[1].trim();
        const offset = this._parseImm(offStr, labels, pc);
        return { offset, reg: m[2] };
    }

    encodeRType(funct7, rs2, rs1, funct3, rd, opcode) {
        return (((funct7 & 0x7F) << 25) |
                ((rs2 & 0x1F) << 20) |
                ((rs1 & 0x1F) << 15) |
                ((funct3 & 0x7) << 12) |
                ((rd & 0x1F) << 7) |
                (opcode & 0x7F)) >>> 0;
    }

    encodeIType(imm, rs1, funct3, rd, opcode) {
        return (((imm & 0xFFF) << 20) |
                ((rs1 & 0x1F) << 15) |
                ((funct3 & 0x7) << 12) |
                ((rd & 0x1F) << 7) |
                (opcode & 0x7F)) >>> 0;
    }

    encodeSType(imm, rs2, rs1, funct3, opcode) {
        const imm11_5 = (imm >> 5) & 0x7F;
        const imm4_0 = imm & 0x1F;
        return (((imm11_5) << 25) |
                ((rs2 & 0x1F) << 20) |
                ((rs1 & 0x1F) << 15) |
                ((funct3 & 0x7) << 12) |
                ((imm4_0) << 7) |
                (opcode & 0x7F)) >>> 0;
    }

    encodeBType(imm, rs2, rs1, funct3, opcode) {
        const b12 = (imm >> 12) & 1;
        const b11 = (imm >> 11) & 1;
        const b10_5 = (imm >> 5) & 0x3F;
        const b4_1 = (imm >> 1) & 0xF;
        return ((b12 << 31) |
                (b10_5 << 25) |
                ((rs2 & 0x1F) << 20) |
                ((rs1 & 0x1F) << 15) |
                ((funct3 & 0x7) << 12) |
                (b4_1 << 8) |
                (b11 << 7) |
                (opcode & 0x7F)) >>> 0;
    }

    encodeUType(imm, rd, opcode) {
        return (((imm >>> 0) & 0xFFFFF000) |
                ((rd & 0x1F) << 7) |
                (opcode & 0x7F)) >>> 0;
    }

    encodeJType(imm, rd, opcode) {
        const b20 = (imm >> 20) & 1;
        const b10_1 = (imm >> 1) & 0x3FF;
        const b11 = (imm >> 11) & 1;
        const b19_12 = (imm >> 12) & 0xFF;
        return ((b20 << 31) |
                (b10_1 << 21) |
                (b11 << 20) |
                (b19_12 << 12) |
                ((rd & 0x1F) << 7) |
                (opcode & 0x7F)) >>> 0;
    }

    _wordToBytes(word) {
        return [
            word & 0xFF,
            (word >>> 8) & 0xFF,
            (word >>> 16) & 0xFF,
            (word >>> 24) & 0xFF,
        ];
    }

    _instructionSize(mnemonic, args, labels) {
        switch (mnemonic) {
            case 'li': {
                const imm = this._parseImm(args[1], labels, 0);
                if (!isNaN(imm) && imm >= -2048 && imm <= 2047) return 4;
                return 8;
            }
            case 'la':
                return 8;
            case 'call':
                return 8;
            default:
                return 4;
        }
    }

    assemble(source) {
        const lines = source.split('\n');
        const errors = [];
        const labels = {};
        const parsedLines = [];

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            const commentIdx1 = line.indexOf('#');
            const commentIdx2 = line.indexOf(';');
            let commentIdx = -1;
            if (commentIdx1 >= 0 && commentIdx2 >= 0) commentIdx = Math.min(commentIdx1, commentIdx2);
            else if (commentIdx1 >= 0) commentIdx = commentIdx1;
            else if (commentIdx2 >= 0) commentIdx = commentIdx2;
            if (commentIdx >= 0) line = line.substring(0, commentIdx);
            line = line.trim();
            if (!line) { parsedLines.push({ lineNum: i + 1, label: null, mnemonic: null, args: [], original: lines[i] }); continue; }

            let label = null;
            const labelMatch = line.match(/^(\w+)\s*:\s*(.*)/);
            if (labelMatch) {
                label = labelMatch[1];
                line = labelMatch[2].trim();
            }

            if (!line) {
                parsedLines.push({ lineNum: i + 1, label, mnemonic: null, args: [], original: lines[i] });
                continue;
            }

            if (line.startsWith('.')) {
                parsedLines.push({ lineNum: i + 1, label, mnemonic: line.toLowerCase(), args: [], original: lines[i], directive: true });
                continue;
            }

            const parts = line.match(/^(\S+)\s*(.*)/);
            if (!parts) {
                parsedLines.push({ lineNum: i + 1, label, mnemonic: null, args: [], original: lines[i] });
                continue;
            }
            const mnemonic = parts[1].toLowerCase();
            const argStr = parts[2] ? parts[2].trim() : '';
            const args = argStr ? this._splitArgs(argStr) : [];
            parsedLines.push({ lineNum: i + 1, label, mnemonic, args, original: lines[i] });
        }

        let addr = 0;
        for (const pl of parsedLines) {
            if (pl.label) {
                labels[pl.label] = addr;
            }
            if (pl.directive) continue;
            if (!pl.mnemonic) continue;
            const size = this._instructionSize(pl.mnemonic, pl.args, labels);
            pl.addr = addr;
            addr += size;
        }

        const output = [];
        const listing = [];
        addr = 0;

        for (const pl of parsedLines) {
            if (pl.directive) continue;
            if (!pl.mnemonic) continue;

            const lineNum = pl.lineNum;
            const mnemonic = pl.mnemonic;
            const args = pl.args;
            const currentPC = addr;

            try {
                const words = this._assembleInstruction(mnemonic, args, labels, currentPC, lineNum);
                if (words === null) {
                    errors.push({ line: lineNum, message: `Unknown instruction: ${mnemonic}` });
                    addr += 4;
                    continue;
                }
                for (let wi = 0; wi < words.length; wi++) {
                    const w = words[wi];
                    const bytes = this._wordToBytes(w);
                    output.push(...bytes);
                    listing.push({
                        addr: currentPC + wi * 4,
                        hex: '0x' + (w >>> 0).toString(16).padStart(8, '0'),
                        source: wi === 0 ? pl.original.trim() : '',
                    });
                }
                addr += words.length * 4;
            } catch (e) {
                errors.push({ line: lineNum, message: e.message });
                addr += 4;
            }
        }

        return {
            success: errors.length === 0,
            bytes: new Uint8Array(output),
            errors,
            listing,
        };
    }

    _assembleInstruction(mnemonic, args, labels, pc, lineNum) {
        const pseudoResult = this._tryPseudo(mnemonic, args, labels, pc, lineNum);
        if (pseudoResult !== undefined) return pseudoResult;

        switch (mnemonic) {
            case 'add': return [this._rtype(args, 0x00, 0x0, lineNum)];
            case 'sub': return [this._rtype(args, 0x20, 0x0, lineNum)];
            case 'and': return [this._rtype(args, 0x00, 0x7, lineNum)];
            case 'or':  return [this._rtype(args, 0x00, 0x6, lineNum)];
            case 'xor': return [this._rtype(args, 0x00, 0x4, lineNum)];
            case 'sll': return [this._rtype(args, 0x00, 0x1, lineNum)];
            case 'srl': return [this._rtype(args, 0x00, 0x5, lineNum)];
            case 'sra': return [this._rtype(args, 0x20, 0x5, lineNum)];
            case 'slt': return [this._rtype(args, 0x00, 0x2, lineNum)];
            case 'sltu': return [this._rtype(args, 0x00, 0x3, lineNum)];

            case 'addi':  return [this._itype(args, 0x0, 0x13, labels, pc, lineNum)];
            case 'andi':  return [this._itype(args, 0x7, 0x13, labels, pc, lineNum)];
            case 'ori':   return [this._itype(args, 0x6, 0x13, labels, pc, lineNum)];
            case 'xori':  return [this._itype(args, 0x4, 0x13, labels, pc, lineNum)];
            case 'slti':  return [this._itype(args, 0x2, 0x13, labels, pc, lineNum)];
            case 'sltiu': return [this._itype(args, 0x3, 0x13, labels, pc, lineNum)];

            case 'slli': return [this._shiftImm(args, 0x00, 0x1, lineNum)];
            case 'srli': return [this._shiftImm(args, 0x00, 0x5, lineNum)];
            case 'srai': return [this._shiftImm(args, 0x20, 0x5, lineNum)];

            case 'lb':  return [this._load(args, 0x0, labels, pc, lineNum)];
            case 'lh':  return [this._load(args, 0x1, labels, pc, lineNum)];
            case 'lw':  return [this._load(args, 0x2, labels, pc, lineNum)];
            case 'lbu': return [this._load(args, 0x4, labels, pc, lineNum)];
            case 'lhu': return [this._load(args, 0x5, labels, pc, lineNum)];

            case 'sb': return [this._store(args, 0x0, labels, pc, lineNum)];
            case 'sh': return [this._store(args, 0x1, labels, pc, lineNum)];
            case 'sw': return [this._store(args, 0x2, labels, pc, lineNum)];

            case 'beq':  return [this._branch(args, 0x0, labels, pc, lineNum)];
            case 'bne':  return [this._branch(args, 0x1, labels, pc, lineNum)];
            case 'blt':  return [this._branch(args, 0x4, labels, pc, lineNum)];
            case 'bge':  return [this._branch(args, 0x5, labels, pc, lineNum)];
            case 'bltu': return [this._branch(args, 0x6, labels, pc, lineNum)];
            case 'bgeu': return [this._branch(args, 0x7, labels, pc, lineNum)];

            case 'lui': {
                const rd = this._parseReg(args[0]);
                if (rd < 0) throw new Error(`Invalid register: ${args[0]}`);
                const imm = this._parseImm(args[1], labels, pc);
                if (isNaN(imm)) throw new Error(`Invalid immediate: ${args[1]}`);
                return [this.encodeUType(imm << 12, rd, 0x37)];
            }
            case 'auipc': {
                const rd = this._parseReg(args[0]);
                if (rd < 0) throw new Error(`Invalid register: ${args[0]}`);
                const imm = this._parseImm(args[1], labels, pc);
                if (isNaN(imm)) throw new Error(`Invalid immediate: ${args[1]}`);
                return [this.encodeUType(imm << 12, rd, 0x17)];
            }

            case 'jal': {
                if (args.length === 1) {
                    const imm = this._resolveLabel(args[0], labels, pc);
                    return [this.encodeJType(imm, 1, 0x6F)];
                }
                const rd = this._parseReg(args[0]);
                if (rd < 0) throw new Error(`Invalid register: ${args[0]}`);
                const imm = this._resolveLabel(args[1], labels, pc);
                return [this.encodeJType(imm, rd, 0x6F)];
            }
            case 'jalr': {
                if (args.length === 3) {
                    const rd = this._parseReg(args[0]);
                    const rs1 = this._parseReg(args[1]);
                    const imm = this._parseImm(args[2], labels, pc);
                    if (rd < 0) throw new Error(`Invalid register: ${args[0]}`);
                    if (rs1 < 0) throw new Error(`Invalid register: ${args[1]}`);
                    if (isNaN(imm)) throw new Error(`Invalid immediate: ${args[2]}`);
                    return [this.encodeIType(imm, rs1, 0x0, rd, 0x67)];
                }
                if (args.length === 2) {
                    const rd = this._parseReg(args[0]);
                    const mem = this._parseMemOperandWithLabel(args[1], labels, pc);
                    if (rd >= 0 && mem) {
                        const rs1 = this._parseReg(mem.reg);
                        if (rs1 < 0) throw new Error(`Invalid register: ${mem.reg}`);
                        return [this.encodeIType(mem.offset, rs1, 0x0, rd, 0x67)];
                    }
                    if (rd >= 0) {
                        const rs1 = this._parseReg(args[1]);
                        if (rs1 >= 0) return [this.encodeIType(0, rs1, 0x0, rd, 0x67)];
                    }
                    throw new Error(`Invalid JALR operands`);
                }
                throw new Error(`JALR requires 2-3 operands`);
            }

            case 'ecall':  return [this.encodeIType(0, 0, 0, 0, 0x73)];
            case 'ebreak': return [this.encodeIType(1, 0, 0, 0, 0x73)];

            case 'cap.load': return [this._capLoad(args, lineNum)];
            case 'cap.save': return [this._capSave(args, lineNum)];
            case 'cap.call': return [this._capCall(args, lineNum)];
            case 'cap.return': return [this._capReturn(lineNum)];
            case 'cap.change': return [this._capChange(args, lineNum)];
            case 'cap.switch': return [this._capSwitch(args, lineNum)];
            case 'cap.tperm': return [this._capTperm(args, lineNum)];

            default:
                return null;
        }
    }

    _tryPseudo(mnemonic, args, labels, pc, lineNum) {
        switch (mnemonic) {
            case 'nop':
                return [this.encodeIType(0, 0, 0x0, 0, 0x13)];
            case 'mv': {
                const rd = this._parseReg(args[0]);
                const rs = this._parseReg(args[1]);
                if (rd < 0) throw new Error(`Invalid register: ${args[0]}`);
                if (rs < 0) throw new Error(`Invalid register: ${args[1]}`);
                return [this.encodeIType(0, rs, 0x0, rd, 0x13)];
            }
            case 'li': {
                const rd = this._parseReg(args[0]);
                if (rd < 0) throw new Error(`Invalid register: ${args[0]}`);
                const imm = this._parseImm(args[1], labels, pc);
                if (isNaN(imm)) throw new Error(`Invalid immediate: ${args[1]}`);
                if (imm >= -2048 && imm <= 2047) {
                    return [this.encodeIType(imm, 0, 0x0, rd, 0x13)];
                }
                let upper = imm >>> 12;
                let lower = imm & 0xFFF;
                if (lower & 0x800) {
                    upper = (upper + 1) & 0xFFFFF;
                    lower = lower | 0xFFFFF000;
                }
                return [
                    this.encodeUType(upper << 12, rd, 0x37),
                    this.encodeIType(lower, rd, 0x0, rd, 0x13),
                ];
            }
            case 'la': {
                const rd = this._parseReg(args[0]);
                if (rd < 0) throw new Error(`Invalid register: ${args[0]}`);
                const target = this._resolveLabel(args[1], labels, pc);
                let upper = (target + 0x800) >>> 12;
                let lower = target - (upper << 12);
                return [
                    this.encodeUType(upper << 12, rd, 0x17),
                    this.encodeIType(lower & 0xFFF, rd, 0x0, rd, 0x13),
                ];
            }
            case 'j': {
                const imm = this._resolveLabel(args[0], labels, pc);
                return [this.encodeJType(imm, 0, 0x6F)];
            }
            case 'jr': {
                const rs = this._parseReg(args[0]);
                if (rs < 0) throw new Error(`Invalid register: ${args[0]}`);
                return [this.encodeIType(0, rs, 0x0, 0, 0x67)];
            }
            case 'ret':
                return [this.encodeIType(0, 1, 0x0, 0, 0x67)];
            case 'call': {
                const offset = this._resolveLabel(args[0], labels, pc);
                let upper = (offset + 0x800) >>> 12;
                let lower = offset - (upper << 12);
                return [
                    this.encodeUType(upper << 12, 1, 0x17),
                    this.encodeIType(lower & 0xFFF, 1, 0x0, 1, 0x67),
                ];
            }
            case 'not': {
                const rd = this._parseReg(args[0]);
                const rs = this._parseReg(args[1]);
                if (rd < 0) throw new Error(`Invalid register: ${args[0]}`);
                if (rs < 0) throw new Error(`Invalid register: ${args[1]}`);
                return [this.encodeIType(-1, rs, 0x4, rd, 0x13)];
            }
            case 'neg': {
                const rd = this._parseReg(args[0]);
                const rs = this._parseReg(args[1]);
                if (rd < 0) throw new Error(`Invalid register: ${args[0]}`);
                if (rs < 0) throw new Error(`Invalid register: ${args[1]}`);
                return [this.encodeRType(0x20, rs, 0, 0x0, rd, 0x33)];
            }
            case 'beqz': {
                const rs = this._parseReg(args[0]);
                if (rs < 0) throw new Error(`Invalid register: ${args[0]}`);
                const imm = this._resolveLabel(args[1], labels, pc);
                return [this.encodeBType(imm, 0, rs, 0x0, 0x63)];
            }
            case 'bnez': {
                const rs = this._parseReg(args[0]);
                if (rs < 0) throw new Error(`Invalid register: ${args[0]}`);
                const imm = this._resolveLabel(args[1], labels, pc);
                return [this.encodeBType(imm, 0, rs, 0x1, 0x63)];
            }
            default:
                return undefined;
        }
    }

    _resolveLabel(s, labels, pc) {
        s = s.trim();
        if (labels.hasOwnProperty(s)) {
            return labels[s] - pc;
        }
        const imm = this._parseImm(s, null, pc);
        if (isNaN(imm)) throw new Error(`Unknown label or invalid immediate: ${s}`);
        return imm;
    }

    _rtype(args, funct7, funct3, lineNum) {
        if (args.length !== 3) throw new Error(`R-type requires 3 operands, got ${args.length}`);
        const rd = this._parseReg(args[0]);
        const rs1 = this._parseReg(args[1]);
        const rs2 = this._parseReg(args[2]);
        if (rd < 0) throw new Error(`Invalid register: ${args[0]}`);
        if (rs1 < 0) throw new Error(`Invalid register: ${args[1]}`);
        if (rs2 < 0) throw new Error(`Invalid register: ${args[2]}`);
        return this.encodeRType(funct7, rs2, rs1, funct3, rd, 0x33);
    }

    _itype(args, funct3, opcode, labels, pc, lineNum) {
        if (args.length !== 3) throw new Error(`I-type requires 3 operands, got ${args.length}`);
        const rd = this._parseReg(args[0]);
        const rs1 = this._parseReg(args[1]);
        const imm = this._parseImm(args[2], labels, pc);
        if (rd < 0) throw new Error(`Invalid register: ${args[0]}`);
        if (rs1 < 0) throw new Error(`Invalid register: ${args[1]}`);
        if (isNaN(imm)) throw new Error(`Invalid immediate: ${args[2]}`);
        return this.encodeIType(imm, rs1, funct3, rd, opcode);
    }

    _shiftImm(args, funct7, funct3, lineNum) {
        if (args.length !== 3) throw new Error(`Shift requires 3 operands, got ${args.length}`);
        const rd = this._parseReg(args[0]);
        const rs1 = this._parseReg(args[1]);
        const shamt = this._parseImm(args[2], null, 0);
        if (rd < 0) throw new Error(`Invalid register: ${args[0]}`);
        if (rs1 < 0) throw new Error(`Invalid register: ${args[1]}`);
        if (isNaN(shamt)) throw new Error(`Invalid shift amount: ${args[2]}`);
        return this.encodeRType(funct7, shamt & 0x1F, rs1, funct3, rd, 0x13);
    }

    _load(args, funct3, labels, pc, lineNum) {
        if (args.length !== 2) throw new Error(`Load requires 2 operands, got ${args.length}`);
        const rd = this._parseReg(args[0]);
        if (rd < 0) throw new Error(`Invalid register: ${args[0]}`);
        const mem = this._parseMemOperandWithLabel(args[1], labels, pc);
        if (!mem) throw new Error(`Invalid memory operand: ${args[1]}`);
        const rs1 = this._parseReg(mem.reg);
        if (rs1 < 0) throw new Error(`Invalid base register: ${mem.reg}`);
        return this.encodeIType(mem.offset, rs1, funct3, rd, 0x03);
    }

    _store(args, funct3, labels, pc, lineNum) {
        if (args.length !== 2) throw new Error(`Store requires 2 operands, got ${args.length}`);
        const rs2 = this._parseReg(args[0]);
        if (rs2 < 0) throw new Error(`Invalid register: ${args[0]}`);
        const mem = this._parseMemOperandWithLabel(args[1], labels, pc);
        if (!mem) throw new Error(`Invalid memory operand: ${args[1]}`);
        const rs1 = this._parseReg(mem.reg);
        if (rs1 < 0) throw new Error(`Invalid base register: ${mem.reg}`);
        return this.encodeSType(mem.offset, rs2, rs1, funct3, 0x23);
    }

    _branch(args, funct3, labels, pc, lineNum) {
        if (args.length !== 3) throw new Error(`Branch requires 3 operands, got ${args.length}`);
        const rs1 = this._parseReg(args[0]);
        const rs2 = this._parseReg(args[1]);
        if (rs1 < 0) throw new Error(`Invalid register: ${args[0]}`);
        if (rs2 < 0) throw new Error(`Invalid register: ${args[1]}`);
        const imm = this._resolveLabel(args[2], labels, pc);
        return this.encodeBType(imm, rs2, rs1, funct3, 0x63);
    }

    encodeChurchJType(index, crField1, crField2, opcode) {
        return (((index & 0x7FFF) << 17) |
                ((crField1 & 0x7) << 12) |
                ((crField2 & 0x7) << 9) |
                (opcode & 0x7F)) >>> 0;
    }

    _capLoad(args, lineNum) {
        if (args.length !== 3) throw new Error(`CAP.LOAD requires 3 operands: CRd, CRs, index`);
        const crDst = this._parseCR(args[0]);
        const crSrc = this._parseCR(args[1]);
        const index = this._parseImm(args[2], null, 0);
        if (crDst < 0) throw new Error(`Invalid destination capability register: ${args[0]}`);
        if (crSrc < 0) throw new Error(`Invalid source capability register: ${args[1]}`);
        if (isNaN(index) || index < 0 || index > 32767) throw new Error(`Invalid index: ${args[2]} (must be 0-32767)`);
        return this.encodeChurchJType(index, crSrc, crDst, 0x2B);
    }

    _capSave(args, lineNum) {
        if (args.length !== 3) throw new Error(`CAP.SAVE requires 3 operands: CRsrc, CRdst_list, index`);
        const crSrcCap = this._parseCR(args[0]);
        const crDstList = this._parseCR(args[1]);
        const index = this._parseImm(args[2], null, 0);
        if (crSrcCap < 0) throw new Error(`Invalid source capability register: ${args[0]}`);
        if (crDstList < 0) throw new Error(`Invalid destination C-List register: ${args[1]}`);
        if (isNaN(index) || index < 0 || index > 32767) throw new Error(`Invalid index: ${args[2]} (must be 0-32767)`);
        return this.encodeChurchJType(index, crDstList, crSrcCap, 0x7B);
    }

    _capCall(args, lineNum) {
        if (args.length !== 1) throw new Error(`CAP.CALL requires 1 operand: CRs`);
        const cr = this._parseCR(args[0]);
        if (cr < 0) throw new Error(`Invalid capability register: ${args[0]}`);
        return (((cr & 0x7) << 12) | 0x5B) >>> 0;
    }

    _capReturn(lineNum) {
        return this.encodeRType(0, 0, 0, 0x0, 0, 0x0B);
    }

    _capChange(args, lineNum) {
        if (args.length !== 1) throw new Error(`CAP.CHANGE requires 1 operand`);
        const cr = this._parseCR(args[0]);
        if (cr < 0) throw new Error(`Invalid capability register: ${args[0]}`);
        return this.encodeRType(0, cr, 0, 0x1, 0, 0x0B);
    }

    _capTperm(args, lineNum) {
        if (args.length !== 2) throw new Error(`CAP.TPERM requires 2 operands: rd, CRs`);
        const rd = this._parseReg(args[0]);
        const cr = this._parseCR(args[1]);
        if (rd < 0) throw new Error(`Invalid register: ${args[0]}`);
        if (cr < 0) throw new Error(`Invalid capability register: ${args[1]}`);
        return this.encodeRType(0, cr, 0, 0x3, rd, 0x0B);
    }

    _capSwitch(args, lineNum) {
        if (args.length !== 2) throw new Error(`CAP.SWITCH requires 2 operands: CRs, CR8-CR15`);
        const cr = this._parseCR(args[0]);
        if (cr < 0) throw new Error(`Invalid source capability register: ${args[0]}`);
        const targetStr = args[1].toLowerCase().trim();
        const targetMatch = targetStr.match(/^(?:cr|c)(\d+)$/);
        if (!targetMatch) throw new Error(`Invalid target register: ${args[1]} (must be CR8-CR15)`);
        const targetNum = parseInt(targetMatch[1]);
        if (targetNum < 8 || targetNum > 15) throw new Error(`Invalid SWITCH target: ${args[1]} (must be CR8-CR15)`);
        const switchOffset = targetNum - 8;
        const funct7upper = (switchOffset & 0x7) << 2;
        return (((funct7upper & 0x7F) << 25) |
                ((cr & 0x1F) << 20) |
                (0 << 15) |
                (0x2 << 12) |
                (0 << 7) |
                0x0B) >>> 0;
    }
}

if (typeof window !== 'undefined') {
    window.RiscVAssembler = RiscVAssembler;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RiscVAssembler };
}
