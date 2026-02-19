class ChurchAssembler {
    constructor() {
        this.opcodes = {
            'LOAD': 0, 'SAVE': 1, 'CALL': 2, 'RETURN': 3,
            'CHANGE': 4, 'SWITCH': 5, 'TPERM': 6, 'LAMBDA': 7,
            'ELOADCALL': 8, 'XLOADLAMBDA': 9,
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
            'E': 8, 'LS': 9, 'LE': 10, 'SE': 11, 'LSE': 12,
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
            this.errors.push({ line: lineNum, message: `Unknown instruction: ${mnemonic}` });
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
                    imm = this._parseImm(parts[2], lineNum) & 0xF;
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
        }

        return (
            ((opcode & 0xF) << 28) |
            ((cond & 0xF) << 24) |
            ((crDst & 0xF) << 20) |
            ((crSrc & 0xF) << 16) |
            (imm & 0xFFFF)
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

        const opcode = (word >>> 28) & 0xF;
        const cond = (word >>> 24) & 0xF;
        const crDst = (word >>> 20) & 0xF;
        const crSrc = (word >>> 16) & 0xF;
        const imm = word & 0xFFFF;

        const opNames = ['LOAD','SAVE','CALL','RETURN','CHANGE','SWITCH','TPERM','LAMBDA','ELOADCALL','XLOADLAMBDA'];
        const condNames = ['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','','NV'];

        if (opcode > 9) return `??? 0x${word.toString(16).padStart(8, '0')}`;

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
                const presetNames = ['CLEAR','R','RW','X','RX','RWX','L','S','E','LS','LE','SE','LSE','RSV','RSV','RSV'];
                return `${mnemonic} CR${crDst}, ${presetNames[imm & 0xF]}`;
            }
            case 7: return `${mnemonic} CR${crDst}`;
            case 8: return `${mnemonic} CR${crDst}, [CR${crSrc} + ${imm}]`;
            case 9: return `${mnemonic} CR${crDst}, [CR${crSrc} + ${imm}]`;
            default: return `??? 0x${word.toString(16)}`;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChurchAssembler;
}
