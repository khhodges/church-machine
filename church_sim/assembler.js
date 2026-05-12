class ChurchAssembler {
    constructor() {
        this.opcodes = {
            'LOAD': 0, 'SAVE': 1, 'CALL': 2, 'RETURN': 3,
            'CHANGE': 4, 'SWITCH': 5, 'TPERM': 6, 'LAMBDA': 7,
            'ELOADCALL': 8, 'XLOADLAMBDA': 9,
            'DREAD': 10, 'DWRITE': 11,
            'BFEXT': 12, 'BFINS': 13,
            'MCMP': 14, 'IADD': 15, 'ISUB': 16,
            'BRANCH': 17, 'SHL': 18, 'SHR': 19,
        };
        this.conditions = {
            'EQ': 0, 'NE': 1, 'CS': 2, 'CC': 3,
            'MI': 4, 'PL': 5, 'VS': 6, 'VC': 7,
            'HI': 8, 'LS': 9, 'GE': 10, 'LT': 11,
            'GT': 12, 'LE': 13, 'AL': 14, 'NV': 15,
            'HS': 2, 'LO': 3,
        };
        this.tpermPresets = {
            'CLEAR': 0, 'R': 1, 'RW': 2, 'X': 3,
            'RX': 4, 'RWX': 5, 'L': 6, 'S': 7,
            'E': 8, 'LS': 9,
            'B': 0x10, 'RB': 0x11, 'RWB': 0x12, 'XB': 0x13,
            'RXB': 0x14, 'RWXB': 0x15, 'LB': 0x16, 'SB': 0x17,
            'EB': 0x18, 'LSB': 0x19,
        };
        this.labels = {};
        this.errors = [];
    }

    assemble(source) {
        this.labels = {};
        this.errors = [];
        const lines = source.split('\n');
        const instructions = [];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            let line = lines[lineNum].trim();
            const commentIdx = line.indexOf(';');
            if (commentIdx >= 0) line = line.substring(0, commentIdx).trim();
            const dashComment = line.indexOf('--');
            if (dashComment >= 0) line = line.substring(0, dashComment).trim();
            if (!line) continue;

            if (line.endsWith(':')) {
                this.labels[line.slice(0, -1).trim()] = instructions.length;
                continue;
            }

            // ── MVN pseudo-instruction ─────────────────────────────────────────
            // MVN DRd, DRs  →  ~DRs  (ARM-style move-bitwise-NOT)
            // Expands to three instructions using two's complement identity:
            //   ISUB DRd, DRs, DRs  ; DRd = 0
            //   ISUB DRd, DRd, DRs  ; DRd = -DRs
            //   IADD DRd, DRd, #-1  ; DRd = -DRs - 1 = ~DRs
            // DRd must differ from DRs — same-register form is a compile-time error.
            // Conditional variants (MVNEQ, MVNNE, MVNMI, etc.) are supported;
            // the condition suffix is propagated to all three expanded instructions.
            {
                const mvnMatch = line.match(/^MVN([A-Z]{2})?\b/i);
                if (mvnMatch) {
                    const cc = (mvnMatch[1] || '').toUpperCase();
                    const mvnParts = line.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
                    const drDst = (mvnParts[1] || 'DR0').replace(/,/g, '').trim();
                    const drSrc = (mvnParts[2] || 'DR0').replace(/,/g, '').trim();
                    const dstMatch = drDst.match(/^DR(\d+)$/i);
                    const srcMatch = drSrc.match(/^DR(\d+)$/i);
                    if (dstMatch && srcMatch && parseInt(dstMatch[1]) === parseInt(srcMatch[1])) {
                        this.errors.push({ line: lineNum + 1,
                            message: `MVN${cc}: destination and source must be different registers (both are ${drDst.toUpperCase()}). ` +
                                `Use a scratch register, e.g.  MVN${cc} DR1, DR2  then copy DR1 → DR2 if needed.` });
                        continue;
                    }
                    instructions.push({ line: `ISUB${cc} ${drDst}, ${drSrc}, ${drSrc}`, lineNum: lineNum + 1 });
                    instructions.push({ line: `ISUB${cc} ${drDst}, ${drDst}, ${drSrc}`, lineNum: lineNum + 1 });
                    instructions.push({ line: `IADD${cc} ${drDst}, ${drDst}, #-1`,      lineNum: lineNum + 1 });
                    continue;
                }
            }

            instructions.push({ line, lineNum: lineNum + 1 });
        }

        const words = [];
        for (const inst of instructions) {
            const word = this._assembleLine(inst.line, inst.lineNum, instructions.indexOf(inst));
            if (word !== null) {
                words.push(word);
            }
        }

        return { words, errors: this.errors, labels: this.labels };
    }

    _assembleLine(line, lineNum, addr) {
        const parts = line.replace(/,/g, ' ').replace(/\[/g, ' ').replace(/\]/g, ' ').split(/\s+/).filter(Boolean);
        if (parts.length === 0) return null;

        let mnemonic = parts[0].toUpperCase();
        let opcode = null;
        let cond = 14;

        for (const [name, code] of Object.entries(this.opcodes)) {
            if (mnemonic === name) {
                opcode = code;
                break;
            }
            if (mnemonic.startsWith(name)) {
                const suffix = mnemonic.substring(name.length);
                if (this.conditions[suffix] !== undefined) {
                    opcode = code;
                    cond = this.conditions[suffix];
                    break;
                }
            }
        }

        if (opcode === null) {
            if (mnemonic === 'HALT' || mnemonic === 'NOP') {
                return 0;
            }
            // MVN/MVNcc is intercepted in the instruction-collection pass and never reaches here.
            const pseudoHint = ' Pseudo-instructions (handled before encoding): NOP, HALT, MVN, MVNcc (e.g. MVNEQ, MVNNE).';
            this.errors.push({ line: lineNum, message: `Unknown instruction: ${mnemonic}.${pseudoHint}` });
            return null;
        }

        let crDst = 0, crSrc = 0, imm = 0;

        switch (opcode) {
            case 0: {
                crDst = this._parseCR(parts[1], lineNum);
                crSrc = this._parseCR(parts[2], lineNum);
                imm = this._parseImm(parts[3], lineNum);
                break;
            }
            case 1: {
                crDst = this._parseCR(parts[1], lineNum);
                crSrc = this._parseCR(parts[2], lineNum);
                imm = this._parseImm(parts[3], lineNum);
                break;
            }
            case 2: {
                crDst = this._parseCR(parts[1], lineNum);
                break;
            }
            case 3: {
                crDst = this._parseCR(parts[1], lineNum);
                break;
            }
            case 4: {
                crDst = this._parseCR(parts[1], lineNum);
                imm = this._parseImm(parts[2], lineNum);
                break;
            }
            case 5: {
                crSrc = this._parseCR(parts[1], lineNum);
                imm = this._parseImm(parts[2], lineNum) & 0x7;
                break;
            }
            case 6: {
                crDst = this._parseCR(parts[1], lineNum);
                const presetName = (parts[2] || 'CLEAR').toUpperCase();
                if (this.tpermPresets[presetName] !== undefined) {
                    imm = this.tpermPresets[presetName];
                } else {
                    imm = this._parseImm(parts[2], lineNum) & 0x1F;
                }
                break;
            }
            case 7: {
                crDst = this._parseCR(parts[1], lineNum);
                break;
            }
            case 8: {
                crDst = this._parseCR(parts[1], lineNum);
                crSrc = this._parseCR(parts[2], lineNum);
                imm = this._parseImm(parts[3], lineNum);
                break;
            }
            case 9: {
                crDst = this._parseCR(parts[1], lineNum);
                crSrc = this._parseCR(parts[2], lineNum);
                imm = this._parseImm(parts[3], lineNum);
                break;
            }
            case 10: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseCR(parts[2], lineNum);
                imm = this._parseImm(parts[3], lineNum);
                break;
            }
            case 11: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseCR(parts[2], lineNum);
                imm = this._parseImm(parts[3], lineNum);
                break;
            }
            case 12: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseCR(parts[2], lineNum);
                const pos12 = this._parseImm(parts[3], lineNum) & 0x1F;
                const wid12 = this._parseImm(parts[4], lineNum) & 0x1F;
                imm = (pos12 << 5) | wid12;
                break;
            }
            case 13: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseCR(parts[2], lineNum);
                const pos13 = this._parseImm(parts[3], lineNum) & 0x1F;
                const wid13 = this._parseImm(parts[4], lineNum) & 0x1F;
                imm = (pos13 << 5) | wid13;
                break;
            }
            case 14: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseDR(parts[2], lineNum);
                break;
            }
            case 15: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseDR(parts[2], lineNum);
                // Support optional # immediate operand (e.g. IADD DRd, DRs, #-1)
                // matching the main assembler's encoding: bit14=1 flags immediate mode.
                const p3iadd = (parts[3] || '').replace(/,/g, '').trim();
                if (p3iadd.startsWith('#')) {
                    const immVal = parseInt(p3iadd.substring(1), 10);
                    imm = 0x4000 | ((isNaN(immVal) ? 0 : immVal) & 0x3FFF);
                } else {
                    imm = this._parseDR(parts[3], lineNum);
                }
                break;
            }
            case 16: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseDR(parts[2], lineNum);
                // Support optional # immediate operand (e.g. ISUB DRd, DRs, #1)
                // matching the main assembler's encoding: bit14=1 flags immediate mode.
                const p3isub = (parts[3] || '').replace(/,/g, '').trim();
                if (p3isub.startsWith('#')) {
                    const immVal = parseInt(p3isub.substring(1), 10);
                    imm = 0x4000 | ((isNaN(immVal) ? 0 : immVal) & 0x3FFF);
                } else {
                    imm = this._parseDR(parts[3], lineNum);
                }
                break;
            }
            case 17: {
                imm = this._parseImm(parts[1], lineNum, addr);
                break;
            }
            case 18: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseDR(parts[2], lineNum);
                imm = this._parseImm(parts[3], lineNum) & 0x1F;
                break;
            }
            case 19: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseDR(parts[2], lineNum);
                let shamt = this._parseImm(parts[3], lineNum) & 0x1F;
                let arith = 0;
                if (parts.length > 4 && parts[4].toUpperCase() === 'ASR') {
                    arith = 1;
                }
                imm = (arith << 5) | shamt;
                break;
            }
        }

        return (
            ((opcode & 0x1F) << 27) |
            ((cond & 0xF) << 23) |
            ((crDst & 0xF) << 19) |
            ((crSrc & 0xF) << 15) |
            (imm & 0x7FFF)
        ) >>> 0;
    }

    _parseCR(token, lineNum) {
        if (!token) return 0;
        token = token.toUpperCase().replace(/,/g, '');
        const m = token.match(/^CR(\d+)$/);
        if (m) {
            const idx = parseInt(m[1]);
            if (idx >= 0 && idx <= 15) return idx;
            this.errors.push({ line: lineNum, message: `CR index out of range: ${token}` });
            return 0;
        }
        this.errors.push({ line: lineNum, message: `Expected CRn, got: ${token}` });
        return 0;
    }

    _parseDR(token, lineNum) {
        if (!token) return 0;
        token = token.toUpperCase().replace(/,/g, '');
        const m = token.match(/^DR(\d+)$/);
        if (m) {
            const idx = parseInt(m[1]);
            if (idx >= 0 && idx <= 15) return idx;
            this.errors.push({ line: lineNum, message: `DR index out of range: ${token}` });
            return 0;
        }
        this.errors.push({ line: lineNum, message: `Expected DRn, got: ${token}` });
        return 0;
    }

    _parseImm(token, lineNum) {
        if (!token) return 0;
        token = token.replace(/,/g, '').trim();

        if (token.startsWith('+')) token = token.substring(1);

        if (this.labels[token] !== undefined) {
            return this.labels[token] & 0xFFFF;
        }

        let val = 0;
        if (token.startsWith('0x') || token.startsWith('0X')) {
            val = parseInt(token, 16);
        } else if (token.startsWith('0b') || token.startsWith('0B')) {
            val = parseInt(token.substring(2), 2);
        } else {
            val = parseInt(token, 10);
        }

        if (isNaN(val)) {
            this.errors.push({ line: lineNum, message: `Invalid immediate: ${token}` });
            return 0;
        }
        return val & 0xFFFF;
    }

    disassemble(word) {
        word = word >>> 0;
        if (word === 0) return 'HALT';

        const opcode = (word >>> 27) & 0x1F;
        const cond = (word >>> 23) & 0xF;
        const crDst = (word >>> 19) & 0xF;
        const crSrc = (word >>> 15) & 0xF;
        const imm = word & 0x7FFF;

        const opNames = ['LOAD','SAVE','CALL','RETURN','CHANGE','SWITCH','TPERM','LAMBDA','ELOADCALL','XLOADLAMBDA','DREAD','DWRITE','BFEXT','BFINS','MCMP','IADD','ISUB','BRANCH','SHL','SHR'];
        const condNames = ['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','','NV'];

        if (opcode > 19) return `??? 0x${word.toString(16).padStart(8, '0')}`;

        const op = opNames[opcode];
        const condStr = cond === 14 ? '' : condNames[cond];
        const mnemonic = op + condStr;

        switch (opcode) {
            case 0: return `${mnemonic} CR${crDst}, [CR${crSrc} + ${imm}]`;
            case 1: return `${mnemonic} CR${crDst} → [CR${crSrc} + ${imm}]`;
            case 2: return `${mnemonic} CR${crDst}`;
            case 3: return `${mnemonic} CR${crDst}`;
            case 4: return `${mnemonic} CR${crDst}, idx=${imm}`;
            case 5: return `${mnemonic} CR${crSrc} ↔ CR${imm & 7}`;
            case 6: {
                const presetNames = ['CLEAR','R','RW','X','RX','RWX','L','S','E','LS','RSV','RSV','RSV','RSV','RSV','RSV'];
                const bFlag = (imm >>> 4) & 1;
                const baseName = presetNames[imm & 0xF];
                return `${mnemonic} CR${crDst}, ${baseName}${bFlag ? '+B' : ''}`;
            }
            case 7: return `${mnemonic} CR${crDst}`;
            case 8: return `${mnemonic} CR${crDst}, [CR${crSrc} + ${imm}]`;
            case 9: return `${mnemonic} CR${crDst}, [CR${crSrc} + ${imm}]`;
            case 10: return `${mnemonic} DR${crDst}, [CR${crSrc} + ${imm}]`;
            case 11: return `${mnemonic} DR${crDst}, [CR${crSrc} + ${imm}]`;
            case 12: {
                const pos = (imm >>> 5) & 0x1F;
                const width = imm & 0x1F;
                return `${mnemonic} DR${crDst}, [CR${crSrc}], pos=${pos}, w=${width}`;
            }
            case 13: {
                const pos = (imm >>> 5) & 0x1F;
                const width = imm & 0x1F;
                return `${mnemonic} DR${crDst}, [CR${crSrc}], pos=${pos}, w=${width}`;
            }
            case 14: return `${mnemonic} DR${crDst}, DR${crSrc}`;
            case 15: return `${mnemonic} DR${crDst}, DR${crSrc}, DR${imm & 0xF}`;
            case 16: return `${mnemonic} DR${crDst}, DR${crSrc}, DR${imm & 0xF}`;
            case 17: {
                const soff = (imm & 0x4000) ? (imm | 0xFFFF8000) : imm;
                return `${mnemonic} ${soff >= 0 ? '+' : ''}${soff}`;
            }
            case 18: return `${mnemonic} DR${crDst}, DR${crSrc}, ${imm & 0x1F}`;
            case 19: {
                const arith = (imm >>> 5) & 1;
                const shamt = imm & 0x1F;
                return `${mnemonic} DR${crDst}, DR${crSrc}, ${shamt}${arith ? ' ASR' : ''}`;
            }
            default: return `??? 0x${word.toString(16)}`;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChurchAssembler;
}
