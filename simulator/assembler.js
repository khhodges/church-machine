// =============================================================================
// assembler.js — Church Machine Assembly Language Encoder
// =============================================================================
//
// Implements the two-pass assembler for the Church Machine instruction set.
// Turns human-readable Church assembly mnemonics into 32-bit machine words
// that can be loaded into the simulator or serialised to a hardware binary.
//
// PRIMARY CLASS
//   ChurchAssembler
//     Instantiated once in app.js as `assembler`.
//     Entry point: assemble(sourceText) → { words[], errors[], listing[] }
//
// INSTRUCTION ENCODING  (32-bit word, big-endian field layout)
//
//   All instructions share a common header:
//     bits[31:28]  opcode   (4 bits, 0–18)
//     bit [27]     condition enable
//     bits[26:23]  condition code (ARM-style: EQ/NE/CS/CC/MI/PL/VS/VC/
//                                              HI/LS/GE/LT/GT/LE/AL/NV)
//     bits[22:0]   operand fields  (vary by opcode — see cases in assemble())
//
// OPCODES
//   0  LOAD       CR ← NS[idx]          Load abstraction GT into CR
//   1  SAVE       NS[idx] ← CR          Save CR back to NS slot
//   2  CALL       invoke CR             Enter abstraction, push call frame
//   3  RETURN     unwind call frame     Return to caller
//   4  CHANGE     DR ← imm / DR op DR  Integer / immediate data-register op
//   5  SWITCH     swap CR pair          Exchange two CRs atomically
//   6  TPERM      thread permission     Assert / revoke thread privilege
//   7  LAMBDA     create closure        Mint a new capability from template
//   8  ELOADCALL  c-list[n] → CALL      Load from c-list and call in one op
//   9  XLOADLAMBDA                      Extended load-lambda
//  10  DREAD      read device register  MMIO read from I/O segment
//  11  DWRITE     write device register MMIO write to I/O segment
//  12  BFEXT      bit-field extract     Extract bits[hi:lo] from DR
//  13  BFINS      bit-field insert      Insert bits into DR at [hi:lo]
//  14  MCMP       memory compare        Compare two memory regions
//  15  IADD       integer add           DR ← DR + DR  (or DR + imm)
//  16  ISUB       integer subtract      DR ← DR − DR  (or DR − imm)
//  17  BRANCH     conditional branch    PC-relative jump
//  18  SHL        shift left            DR ← DR << n
//  19  SHR        shift right           DR ← DR >> n  (logical)
//
// CONDITION CODES  (ARM-compatible, bits[26:23])
//   EQ=0  NE=1  CS=2  CC=3  MI=4  PL=5  VS=6  VC=7
//   HI=8  LS=9  GE=10 LT=11 GT=12 LE=13 AL=14 NV=15
//
// ASSEMBLY SYNTAX  (one instruction per line)
//   MNEMONIC  [.COND]  operand, operand, ...
//   ; lines beginning with semicolon are comments
//   ; B:N  marks a tutorial breakpoint (integer N)
//
// LABEL SUPPORT
//   Labels are defined with "name:" on their own line (before any instruction).
//   BRANCH instructions accept a label name as the operand instead of a raw
//   signed offset.  The assembler resolves label → signed relative offset
//   automatically.  Numeric offsets still work unchanged.
//   Example:
//       loop_top:
//           ISUB DR1, DR1, #1
//           BRANCHNE loop_top      ; equivalent to BRANCHNE -1
//
// POST-ASSEMBLY BRANCH BOUNDS CHECK
//   After encoding all words, the assembler verifies that every BRANCH
//   target falls within [0, total_code_words).  Out-of-range targets are
//   reported as assembly errors with the source line number and target address.
//
// PSEUDO-OPS / DIRECTIVES
//   .word  <hex>    — emit a raw 32-bit literal word
//   name:           — define a branch target label (on its own line)
//   ; any text      — comment, stripped before encoding
//
// OUTPUT
//   assemble() returns:
//     words[]    — Uint32Array of encoded machine words
//     errors[]   — { line, message } for any parse failures
//     listing[]  — { addr, word, source } one entry per instruction
//
// HARDWARE CROSS-REFERENCE
//   hardware/call.py      — CALL/RETURN micro-op encoding must match bit[27:23]
//   simulator/simulator.js _bootStep() — hand-coded boot words verified here
//
// =============================================================================

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

        // ── Pass 1: scan lines, record label offsets, collect instruction stubs ──
        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            let line = lines[lineNum].trim();
            const commentIdx = line.indexOf(';');
            if (commentIdx >= 0) line = line.substring(0, commentIdx).trim();
            const dashComment = line.indexOf('--');
            if (dashComment >= 0) line = line.substring(0, dashComment).trim();
            const slashComment = line.indexOf('//');
            if (slashComment >= 0) line = line.substring(0, slashComment).trim();
            if (!line) continue;

            if (line.endsWith(':')) {
                // Label definition — store word offset (= current instruction count)
                const labelName = line.slice(0, -1).trim();
                if (this.labels[labelName] !== undefined) {
                    this.errors.push({ line: lineNum + 1, message: `Label "${labelName}" is defined more than once. Each label must be unique within a code lump.` });
                }
                this.labels[labelName] = instructions.length;
                continue;
            }

            if (line.startsWith('.org ') || line.startsWith('.ORG ')) {
                const target = parseInt(line.substring(5).trim());
                if (!isNaN(target) && target >= instructions.length) {
                    while (instructions.length < target) {
                        instructions.push({ line: 'NOP', lineNum: lineNum + 1, ispad: true });
                    }
                }
                continue;
            }

            if (line.startsWith('.word ') || line.startsWith('.WORD ')) {
                const val = parseInt(line.substring(6).trim());
                instructions.push({ line: null, lineNum: lineNum + 1, rawWord: (isNaN(val) ? 0 : val) >>> 0 });
                continue;
            }

            // The disassembler emits ".header ..." for lump header words.
            // Skip these in both passes — they are documentation artifacts, not
            // code instructions, and must not shift label word offsets.
            if (/^\.header\b/i.test(line)) {
                continue;
            }

            instructions.push({ line, lineNum: lineNum + 1 });
        }

        // ── Pass 2: encode instructions ───────────────────────────────────────────
        // lineNums[i] tracks the source line that produced words[i], used by the
        // bounds-check pass to report accurate error locations.
        const words = [];
        const lineNums = [];
        for (let i = 0; i < instructions.length; i++) {
            const inst = instructions[i];
            if (inst.rawWord !== undefined) {
                words.push(inst.rawWord);
                lineNums.push(inst.lineNum);
                continue;
            }
            if (inst.ispad) {
                words.push(0);
                lineNums.push(inst.lineNum);
                continue;
            }
            // addr = i = word offset of this instruction (matches label offsets stored in pass 1)
            const word = this._assembleLine(inst.line, inst.lineNum, i);
            if (word !== null) {
                words.push(word);
                lineNums.push(inst.lineNum);
            }
        }

        // ── Pass 3: branch bounds check ───────────────────────────────────────────
        // Every BRANCH target must fall within [0, words.length).
        const totalWords = words.length;
        const _condNames = ['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','','NV'];
        for (let i = 0; i < words.length; i++) {
            const w = words[i] >>> 0;
            if (((w >>> 27) & 0x1F) !== 17) continue;   // not a BRANCH instruction
            const rawImm = w & 0x7FFF;
            const signedOffset = (rawImm & 0x4000) ? (rawImm | 0xFFFF8000) : rawImm;
            const target = i + signedOffset;
            if (target < 0 || target >= totalWords) {
                const condCode = (w >>> 23) & 0xF;
                const mnemonic = 'BRANCH' + _condNames[condCode];
                this.errors.push({
                    line: lineNums[i],
                    message: `${mnemonic} at word ${i} → target ${target} is outside the code lump [0, ${totalWords})`
                });
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
            this.errors.push({ line: lineNum, message: `Oops! I don't recognise the instruction "${mnemonic}". Check your spelling — every letter matters!` });
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
                if (parts.length > 1) {
                    imm = this._parseImm(parts[1], lineNum) & 0xFFF;
                }
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
                {
                    const p3 = (parts[3] || '').replace(/,/g, '').trim();
                    if (p3.startsWith('#')) {
                        const immVal = parseInt(p3.substring(1), 10);
                        imm = 0x4000 | ((isNaN(immVal) ? 0 : immVal) & 0x3FFF);
                    } else {
                        imm = this._parseDR(parts[3], lineNum);
                    }
                }
                break;
            }
            case 16: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseDR(parts[2], lineNum);
                {
                    const p3 = (parts[3] || '').replace(/,/g, '').trim();
                    if (p3.startsWith('#')) {
                        const immVal = parseInt(p3.substring(1), 10);
                        imm = 0x4000 | ((isNaN(immVal) ? 0 : immVal) & 0x3FFF);
                    } else {
                        imm = this._parseDR(parts[3], lineNum);
                    }
                }
                break;
            }
            case 17: {
                // BRANCH operand may be a label name or a raw signed integer offset.
                // Labels are resolved to a signed PC-relative offset: label_word - current_word.
                const branchToken = (parts[1] || '').replace(/,/g, '').trim();
                if (branchToken && /^[a-zA-Z_]/.test(branchToken)) {
                    // Identifier-like token → treat as label name
                    if (this.labels[branchToken] !== undefined) {
                        imm = this.labels[branchToken] - addr;   // signed relative offset
                    } else {
                        this.errors.push({ line: lineNum, message: `Label "${branchToken}" is not defined. Define it with "${branchToken}:" on its own line before the target instruction.` });
                        imm = 0;
                    }
                } else {
                    // Numeric literal (decimal, hex, binary, or signed integer)
                    imm = this._parseImm(parts[1], lineNum);
                }
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
        if (!token) {
            this.errors.push({ line: lineNum, message: 'A capability register (like CR0, CR6, CR14) is needed here, but nothing was given.' });
            return 0;
        }
        token = token.toUpperCase().replace(/,/g, '');
        const m = token.match(/^CR(\d+)$/);
        if (m) {
            const idx = parseInt(m[1]);
            if (idx >= 0 && idx <= 15) return idx;
            this.errors.push({ line: lineNum, message: `CR${idx} is too big! Capability registers go from CR0 to CR15 (that's 16 registers).` });
            return 0;
        }
        this.errors.push({ line: lineNum, message: `Expected a capability register like CR0 or CR6, but got "${token}". Capability registers start with CR followed by a number 0-15.` });
        return 0;
    }

    _parseDR(token, lineNum) {
        if (!token) {
            this.errors.push({ line: lineNum, message: 'A data register (like DR0, DR1) is needed here, but nothing was given.' });
            return 0;
        }
        token = token.toUpperCase().replace(/,/g, '');
        const m = token.match(/^DR(\d+)$/);
        if (m) {
            const idx = parseInt(m[1]);
            if (idx >= 0 && idx <= 15) return idx;
            this.errors.push({ line: lineNum, message: `DR${idx} is too big! Data registers go from DR0 to DR15 (that's 16 registers).` });
            return 0;
        }
        this.errors.push({ line: lineNum, message: `Expected a data register like DR0 or DR1, but got "${token}". Data registers start with DR followed by a number 0-15.` });
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
            this.errors.push({ line: lineNum, message: `"${token}" isn't a number I understand. Try a decimal number like 42, hex like 0xFF, or binary like 0b1010.` });
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

        // Lump header: magic=0x1F in top 5 bits — format: magic(5)|n_minus_6(4)|cw(13)|typ(2)|cc(8)
        // typ: 00=lump, 01=data, 10=thread, 11=outform
        if (opcode === 0x1F) {
            const n_minus_6 = (word >>> 23) & 0xF;
            const cw        = (word >>> 10) & 0x1FFF;
            const typ       = (word >>>  8) & 0x3;
            const cc        = word & 0xFF;
            const lumpSize  = 1 << (n_minus_6 + 6);
            const typNames  = ['lump', 'data', 'thread', 'outform'];
            return `.header ${typNames[typ]||'?'} n-6=${n_minus_6}\u2192${lumpSize}w cw=${cw} cc=${cc}`;
        }

        if (opcode > 19) return `??? 0x${word.toString(16).padStart(8, '0')}`;

        const op = opNames[opcode];
        const condStr = cond === 14 ? '' : condNames[cond];
        const mnemonic = op + condStr;

        switch (opcode) {
            case 0: return `${mnemonic} CR${crDst}, CR${crSrc}, ${imm}`;
            case 1: return `${mnemonic} CR${crDst}, CR${crSrc}, ${imm}`;
            case 2: return `${mnemonic} CR${crDst}`;
            case 3: {
                const retMask = imm & 0xFFF;
                return retMask ? `${mnemonic} 0b${retMask.toString(2).padStart(12, '0')}` : mnemonic;
            }
            case 4: return `${mnemonic} CR${crDst}, ${imm}`;
            case 5: return `${mnemonic} CR${crSrc}, ${imm & 7}`;
            case 6: {
                const presetNames = ['CLEAR','R','RW','X','RX','RWX','L','S','E','LS','RSV','RSV','RSV','RSV','RSV','RSV'];
                const bFlag = (imm >>> 4) & 1;
                const baseName = presetNames[imm & 0xF];
                return `${mnemonic} CR${crDst}, ${baseName}${bFlag ? 'B' : ''}`;
            }
            case 7: return `${mnemonic} CR${crDst}`;
            case 8: return `${mnemonic} CR${crDst}, CR${crSrc}, ${imm}`;
            case 9: return `${mnemonic} CR${crDst}, CR${crSrc}, ${imm}`;
            case 10: return `${mnemonic} DR${crDst}, CR${crSrc}, ${imm}`;
            case 11: return `${mnemonic} DR${crDst}, CR${crSrc}, ${imm}`;
            case 12: {
                const pos = (imm >>> 5) & 0x1F;
                const width = imm & 0x1F;
                return `${mnemonic} DR${crDst}, CR${crSrc}, ${pos}, ${width}`;
            }
            case 13: {
                const pos = (imm >>> 5) & 0x1F;
                const width = imm & 0x1F;
                return `${mnemonic} DR${crDst}, CR${crSrc}, ${pos}, ${width}`;
            }
            case 14: return `${mnemonic} DR${crDst}, DR${crSrc}`;
            case 15: return (imm & 0x4000) ? `${mnemonic} DR${crDst}, DR${crSrc}, #${imm & 0x3FFF}` : `${mnemonic} DR${crDst}, DR${crSrc}, DR${imm & 0xF}`;
            case 16: return (imm & 0x4000) ? `${mnemonic} DR${crDst}, DR${crSrc}, #${imm & 0x3FFF}` : `${mnemonic} DR${crDst}, DR${crSrc}, DR${imm & 0xF}`;
            case 17: {
                const soff = (imm & 0x4000) ? (imm | 0xFFFF8000) : imm;
                return `${mnemonic} ${soff}`;
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
