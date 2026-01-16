class CTMMSimulator {
    constructor() {
        this.reset();
    }

    reset() {
        this.contextRegs = {};
        for (let i = 0; i < 8; i++) {
            this.contextRegs[i] = this.createNullCapability();
        }
        
        this.dataRegs = {};
        for (let i = 0; i < 16; i++) {
            this.dataRegs[i] = BigInt(0);
        }
        
        this.cr15 = this.createNullCapability();
        this.cr8 = this.createNullCapability();
        this.ip = 0;
        this.stackDepth = 0;
        
        this.flags = { N: false, Z: false, C: false, V: false };
    }

    createNullCapability() {
        return {
            name: "NULL",
            location: { type: "Local", offset: 0 },
            perms: [],
            locked: false
        };
    }

    createCapability(name, perms = ["R", "W", "X"]) {
        return {
            name: name,
            location: { type: "Local", offset: Math.floor(Math.random() * 1000) },
            perms: perms,
            locked: false
        };
    }

    generateKey() {
        let key = '';
        for (let i = 0; i < 48; i++) {
            key += Math.floor(Math.random() * 16).toString(16).toUpperCase();
        }
        return key.match(/.{1,8}/g).join('-');
    }

    checkCondition(cond) {
        if (!cond || cond === '') return true;
        
        const { N, Z, C, V } = this.flags;
        
        switch (cond.toUpperCase()) {
            case 'EQ': return Z;
            case 'NE': return !Z;
            case 'CS': case 'HS': return C;
            case 'CC': case 'LO': return !C;
            case 'MI': return N;
            case 'PL': return !N;
            case 'VS': return V;
            case 'VC': return !V;
            case 'HI': return C && !Z;
            case 'LS': return !C || Z;
            case 'GE': return N === V;
            case 'LT': return N !== V;
            case 'GT': return !Z && (N === V);
            case 'LE': return Z || (N !== V);
            case 'AL': return true;
            default: return true;
        }
    }

    getDataReg(idx) {
        return this.dataRegs[idx] || BigInt(0);
    }

    setDataReg(idx, value) {
        const mask = BigInt("0xFFFFFFFFFFFFFFFF");
        this.dataRegs[idx] = BigInt(value) & mask;
    }

    updateFlagsArithmetic(result, a, b, op) {
        const mask = BigInt("0xFFFFFFFFFFFFFFFF");
        const signBit = BigInt("0x8000000000000000");
        
        result = result & mask;
        
        this.flags.N = (result & signBit) !== BigInt(0);
        this.flags.Z = result === BigInt(0);
        
        if (op === "ADD" || op === "ADDI" || op === "CMN") {
            this.flags.C = result < a;
            const signA = (a & signBit) !== BigInt(0);
            const signB = (b & signBit) !== BigInt(0);
            const signR = (result & signBit) !== BigInt(0);
            this.flags.V = (signA === signB) && (signA !== signR);
        } else if (op === "SUB" || op === "SUBI" || op === "CMP") {
            this.flags.C = a >= b;
            const signA = (a & signBit) !== BigInt(0);
            const signB = (b & signBit) !== BigInt(0);
            const signR = (result & signBit) !== BigInt(0);
            this.flags.V = (signA !== signB) && (signB === signR);
        } else if (op === "NEG") {
            this.flags.C = b === BigInt(0);
            this.flags.V = b === signBit;
        } else {
            this.flags.C = false;
            this.flags.V = false;
        }
        
        return result;
    }

    updateFlagsLogic(result) {
        const mask = BigInt("0xFFFFFFFFFFFFFFFF");
        const signBit = BigInt("0x8000000000000000");
        result = result & mask;
        
        this.flags.N = (result & signBit) !== BigInt(0);
        this.flags.Z = result === BigInt(0);
        
        return result;
    }

    execute(instr, ...args) {
        const mask = BigInt("0xFFFFFFFFFFFFFFFF");
        
        switch (instr) {
            case "ADD": {
                const [d, s] = args;
                const a = this.getDataReg(d);
                const b = this.getDataReg(s);
                const result = this.updateFlagsArithmetic(a + b, a, b, "ADD");
                this.setDataReg(d, result);
                return `DR${d} = 0x${result.toString(16).toUpperCase()}`;
            }
            
            case "SUB": {
                const [d, s] = args;
                const a = this.getDataReg(d);
                const b = this.getDataReg(s);
                const result = this.updateFlagsArithmetic((a - b) & mask, a, b, "SUB");
                this.setDataReg(d, result);
                return `DR${d} = 0x${result.toString(16).toUpperCase()}`;
            }
            
            case "MUL": {
                const [d, s] = args;
                const a = this.getDataReg(d);
                const b = this.getDataReg(s);
                const result = (a * b) & mask;
                this.updateFlagsLogic(result);
                this.setDataReg(d, result);
                return `DR${d} = 0x${result.toString(16).toUpperCase()}`;
            }
            
            case "MOV": {
                const [d, s] = args;
                const value = this.getDataReg(s);
                this.updateFlagsLogic(value);
                this.setDataReg(d, value);
                return `DR${d} = 0x${value.toString(16).toUpperCase()}`;
            }
            
            case "MVN": {
                const [d, s] = args;
                const value = ~this.getDataReg(s) & mask;
                this.updateFlagsLogic(value);
                this.setDataReg(d, value);
                return `DR${d} = 0x${value.toString(16).toUpperCase()}`;
            }
            
            case "NEG": {
                const [d, s] = args;
                const b = this.getDataReg(s);
                const result = this.updateFlagsArithmetic((BigInt(0) - b) & mask, BigInt(0), b, "NEG");
                this.setDataReg(d, result);
                return `DR${d} = 0x${result.toString(16).toUpperCase()}`;
            }
            
            case "ADDI": {
                const [d, imm] = args;
                const a = this.getDataReg(d);
                const b = BigInt(imm);
                const result = this.updateFlagsArithmetic(a + b, a, b, "ADDI");
                this.setDataReg(d, result);
                return `DR${d} = 0x${result.toString(16).toUpperCase()}`;
            }
            
            case "SUBI": {
                const [d, imm] = args;
                const a = this.getDataReg(d);
                const b = BigInt(imm);
                const result = this.updateFlagsArithmetic((a - b) & mask, a, b, "SUBI");
                this.setDataReg(d, result);
                return `DR${d} = 0x${result.toString(16).toUpperCase()}`;
            }
            
            case "AND": {
                const [d, s] = args;
                const result = this.getDataReg(d) & this.getDataReg(s);
                this.updateFlagsLogic(result);
                this.setDataReg(d, result);
                return `DR${d} = 0x${result.toString(16).toUpperCase()}`;
            }
            
            case "ORR": {
                const [d, s] = args;
                const result = this.getDataReg(d) | this.getDataReg(s);
                this.updateFlagsLogic(result);
                this.setDataReg(d, result);
                return `DR${d} = 0x${result.toString(16).toUpperCase()}`;
            }
            
            case "EOR": {
                const [d, s] = args;
                const result = this.getDataReg(d) ^ this.getDataReg(s);
                this.updateFlagsLogic(result);
                this.setDataReg(d, result);
                return `DR${d} = 0x${result.toString(16).toUpperCase()}`;
            }
            
            case "BIC": {
                const [d, s] = args;
                const result = this.getDataReg(d) & (~this.getDataReg(s) & mask);
                this.updateFlagsLogic(result);
                this.setDataReg(d, result);
                return `DR${d} = 0x${result.toString(16).toUpperCase()}`;
            }
            
            case "NOT": {
                const [d, s] = args;
                const result = ~this.getDataReg(s) & mask;
                this.updateFlagsLogic(result);
                this.setDataReg(d, result);
                return `DR${d} = 0x${result.toString(16).toUpperCase()}`;
            }
            
            case "LSL": {
                const [d, s, amt] = args;
                const value = this.getDataReg(s);
                const shiftAmt = amt % 64;
                if (shiftAmt > 0) {
                    this.flags.C = ((value >> BigInt(64 - shiftAmt)) & BigInt(1)) === BigInt(1);
                }
                const result = (value << BigInt(shiftAmt)) & mask;
                this.flags.N = (result & BigInt("0x8000000000000000")) !== BigInt(0);
                this.flags.Z = result === BigInt(0);
                this.setDataReg(d, result);
                return `DR${d} = 0x${result.toString(16).toUpperCase()}`;
            }
            
            case "LSR": {
                const [d, s, amt] = args;
                const value = this.getDataReg(s);
                const shiftAmt = amt % 64;
                if (shiftAmt > 0) {
                    this.flags.C = ((value >> BigInt(shiftAmt - 1)) & BigInt(1)) === BigInt(1);
                }
                const result = value >> BigInt(shiftAmt);
                this.flags.N = (result & BigInt("0x8000000000000000")) !== BigInt(0);
                this.flags.Z = result === BigInt(0);
                this.setDataReg(d, result);
                return `DR${d} = 0x${result.toString(16).toUpperCase()}`;
            }
            
            case "ASR": {
                const [d, s, amt] = args;
                const value = this.getDataReg(s);
                const shiftAmt = amt % 64;
                const signBit = BigInt("0x8000000000000000");
                const isNegative = (value & signBit) !== BigInt(0);
                
                if (shiftAmt > 0) {
                    this.flags.C = ((value >> BigInt(shiftAmt - 1)) & BigInt(1)) === BigInt(1);
                }
                
                let result = value >> BigInt(shiftAmt);
                if (isNegative && shiftAmt > 0) {
                    const signExtend = (mask << BigInt(64 - shiftAmt)) & mask;
                    result = result | signExtend;
                }
                
                this.flags.N = (result & signBit) !== BigInt(0);
                this.flags.Z = result === BigInt(0);
                this.setDataReg(d, result);
                return `DR${d} = 0x${result.toString(16).toUpperCase()}`;
            }
            
            case "ROR": {
                const [d, s, amt] = args;
                const value = this.getDataReg(s);
                const rotAmt = amt % 64;
                
                const result = ((value >> BigInt(rotAmt)) | (value << BigInt(64 - rotAmt))) & mask;
                
                if (rotAmt > 0) {
                    this.flags.C = ((result & BigInt("0x8000000000000000")) !== BigInt(0));
                }
                this.flags.N = (result & BigInt("0x8000000000000000")) !== BigInt(0);
                this.flags.Z = result === BigInt(0);
                this.setDataReg(d, result);
                return `DR${d} = 0x${result.toString(16).toUpperCase()}`;
            }
            
            case "CMP": {
                const [a, b] = args;
                const valA = this.getDataReg(a);
                const valB = this.getDataReg(b);
                this.updateFlagsArithmetic((valA - valB) & mask, valA, valB, "CMP");
                return `Compared DR${a} with DR${b}`;
            }
            
            case "CMN": {
                const [a, b] = args;
                const valA = this.getDataReg(a);
                const valB = this.getDataReg(b);
                this.updateFlagsArithmetic(valA + valB, valA, valB, "CMN");
                return `Compared DR${a} with -DR${b}`;
            }
            
            case "TST": {
                const [a, b] = args;
                const result = this.getDataReg(a) & this.getDataReg(b);
                this.updateFlagsLogic(result);
                return `Tested DR${a} AND DR${b}`;
            }
            
            case "TEQ": {
                const [a, b] = args;
                const result = this.getDataReg(a) ^ this.getDataReg(b);
                this.updateFlagsLogic(result);
                return `Tested DR${a} XOR DR${b}`;
            }
            
            case "TPERM": {
                const [crIdx, maskStr, boundsOffset] = args;
                
                if (crIdx < 0 || (crIdx > 7 && crIdx !== 8 && crIdx !== 15)) {
                    return `Error: Invalid CR index ${crIdx} (valid: 0-7, 8, 15)`;
                }
                
                const cr = crIdx < 8 ? this.contextRegs[crIdx] : 
                           crIdx === 8 ? this.cr8 : 
                           this.cr15;
                
                const validPerms = ['R', 'W', 'X', 'L', 'S', 'E', 'B', 'M'];
                const requiredPerms = maskStr.toUpperCase().split('').filter(p => validPerms.includes(p));
                const actualPerms = cr.perms || [];
                
                const permsOK = requiredPerms.every(p => actualPerms.includes(p));
                
                const capSize = cr.name === "NULL" ? 0 : 
                               (cr.size || (cr.location.type === "Local" ? 4096 : 65536));
                const boundsOK = boundsOffset === undefined || boundsOffset <= capSize;
                
                const allOK = permsOK && boundsOK;
                const hasAnyPerm = actualPerms.length > 0;
                
                this.flags.N = !hasAnyPerm;
                this.flags.Z = allOK;
                this.flags.C = permsOK;
                this.flags.V = boundsOK;
                
                const result = allOK ? "PASS" : "FAIL";
                const boundsStr = boundsOffset !== undefined ? ` BOUNDS ${boundsOffset}` : "";
                return `TPERM CR${crIdx} ${maskStr}${boundsStr} -> ${result} (Z=${this.flags.Z ? 1 : 0})`;
            }
            
            case "B": {
                const [cond, offset] = args;
                if (this.checkCondition(cond)) {
                    this.ip = offset;
                    return `Branch${cond ? ' (' + cond + ')' : ''} taken to ${offset}`;
                }
                return `Branch${cond ? ' (' + cond + ')' : ''} not taken (condition false)`;
            }
            
            case "BL": {
                const [offset] = args;
                this.dataRegs[7] = BigInt(this.ip + 1);
                this.ip = offset;
                return `Branch with Link to ${offset}, return addr ${this.ip + 1} saved to DR7`;
            }
            
            case "LOAD": {
                const [destCR, srcCR, idx] = args;
                const src = srcCR < 8 ? this.contextRegs[srcCR] : 
                           srcCR === 8 ? this.cr8 : this.cr15;
                
                if (!src.perms.includes('L')) {
                    return `Error: CR${srcCR} lacks Load permission`;
                }
                
                const newCap = {
                    name: `LOADED_${idx}`,
                    location: { type: 'Local', offset: idx * 256 },
                    perms: ['R'],
                    locked: false,
                    goldenKey: this.generateKey()
                };
                
                if (destCR < 8) {
                    this.contextRegs[destCR] = newCap;
                } else if (destCR === 8) {
                    this.cr8 = newCap;
                } else if (destCR === 15) {
                    this.cr15 = newCap;
                }
                
                const destName = destCR === 8 ? 'CR8 (Thread)' : destCR === 15 ? 'CR15 (Namespace)' : `CR${destCR}`;
                return `Loaded capability into ${destName} via CR${srcCR}[${idx}]`;
            }
            
            case "SAVE": {
                const [destCR, srcDR] = args;
                const dest = destCR < 8 ? this.contextRegs[destCR] : 
                            destCR === 8 ? this.cr8 : this.cr15;
                
                if (!dest.perms.includes('S')) {
                    return `Error: CR${destCR} lacks Store permission (S required for capability operations)`;
                }
                return `Saved DR${srcDR} (0x${this.dataRegs[srcDR].toString(16)}) via CR${destCR}`;
            }
            
            case "CALL": {
                const [crIdx] = args;
                const cr = crIdx < 8 ? this.contextRegs[crIdx] : 
                          crIdx === 8 ? this.cr8 : this.cr15;
                
                if (!cr.perms.includes('E')) {
                    return `Error: CR${crIdx} lacks Enter permission`;
                }
                this.stackDepth++;
                return `Called procedure in CR${crIdx} (${cr.name}), stack depth: ${this.stackDepth}`;
            }
            
            case "RETURN": {
                if (this.stackDepth > 0) {
                    this.stackDepth--;
                    return `Returned from procedure, stack depth: ${this.stackDepth}`;
                }
                return `Error: Stack underflow - no procedure to return from`;
            }
            
            case "CHANGE": {
                const [offset] = args;
                this.cr8 = {
                    name: `THREAD_${offset}`,
                    location: { type: 'Local', offset: offset },
                    perms: ['R', 'W'],
                    locked: false,
                    goldenKey: this.generateKey()
                };
                return `Changed to thread at offset ${offset}`;
            }
            
            case "SWITCH": {
                const [crIdx] = args;
                const cr = crIdx < 8 ? this.contextRegs[crIdx] : 
                          crIdx === 8 ? this.cr8 : this.cr15;
                
                if (cr.name === 'NULL') {
                    return `Error: CR${crIdx} is NULL`;
                }
                if (!cr.perms.includes('L') && !cr.perms.includes('E')) {
                    return `Error: CR${crIdx} lacks Load/Enter permission for namespace switch`;
                }
                this.cr15 = { ...cr, goldenKey: cr.goldenKey || this.generateKey() };
                return `Switched namespace to ${cr.name}`;
            }
            
            default:
                return `Unknown instruction: ${instr}`;
        }
    }
}

const simulator = new CTMMSimulator();
