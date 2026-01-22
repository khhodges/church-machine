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
        this.nia = 0;
        this.stackDepth = 0;
        this.callStack = [];
        
        this.flags = { N: false, Z: false, C: false, V: false };
    }
    
    softReset() {
        // Reset only data registers and flags, preserve context registers from boot
        this.dataRegs = {};
        for (let i = 0; i < 16; i++) {
            this.dataRegs[i] = BigInt(0);
        }
        
        this.nia = 0;
        this.stackDepth = 0;
        this.callStack = [];
        
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
                const [crIdx, maskStr, indexArg] = args;
                
                if (crIdx < 0 || (crIdx > 7 && crIdx !== 8 && crIdx !== 15)) {
                    return `FAULT: Invalid CR index ${crIdx} (valid: 0-7, 8, 15)`;
                }
                
                if (maskStr === undefined || maskStr === null) {
                    return `FAULT: TPERM requires permission mask (e.g., TPERM 0 R)`;
                }
                
                const cr = crIdx < 8 ? this.contextRegs[crIdx] : 
                           crIdx === 8 ? this.cr8 : 
                           this.cr15;
                
                if (!cr || cr.name === 'NULL') {
                    this.flags.N = true;
                    this.flags.Z = false;
                    this.flags.C = false;
                    this.flags.V = false;
                    return `TPERM CR${crIdx} [NULL] - no capability loaded (Z=0)`;
                }
                
                const validPerms = ['R', 'W', 'X', 'L', 'S', 'E', 'B', 'M', 'F'];
                const maskString = String(maskStr);
                const requiredPerms = maskString.toUpperCase().split('').filter(p => validPerms.includes(p));
                const actualPerms = cr.perms || [];
                
                const permsOK = requiredPerms.every(p => actualPerms.includes(p));
                
                let objectSize = 0;
                let sizeOK = true;
                let indexOK = true;
                
                if (cr.name !== "NULL") {
                    const nsOffset = cr.nsOffset !== undefined ? cr.nsOffset : 
                                    (cr.location && cr.location.offset !== undefined ? cr.location.offset : null);
                    
                    if (nsOffset !== null && typeof window !== 'undefined' && window.namespaceObjects) {
                        const nsEntry = window.namespaceObjects.find(obj => obj.offset === nsOffset);
                        if (nsEntry) {
                            objectSize = nsEntry.word2_limit || nsEntry.size || 4096;
                        } else {
                            objectSize = cr.size || 4096;
                        }
                    } else {
                        objectSize = cr.size || (cr.location && cr.location.type === "Local" ? 4096 : 65536);
                    }
                    
                    sizeOK = objectSize > 0;
                    
                    if (indexArg !== undefined) {
                        const index = parseInt(indexArg);
                        indexOK = !isNaN(index) && index >= 0 && index < objectSize;
                    }
                }
                
                const allOK = permsOK && sizeOK && indexOK;
                const hasAnyPerm = actualPerms.length > 0;
                
                this.flags.N = !hasAnyPerm;
                this.flags.Z = allOK;
                this.flags.C = permsOK;
                this.flags.V = indexOK && sizeOK;
                
                const result = allOK ? "PASS" : "FAIL";
                let details = [];
                if (!permsOK) details.push("perms");
                if (!sizeOK) details.push("size=0");
                if (indexArg !== undefined && !indexOK) details.push(`idx ${indexArg}>=${objectSize}`);
                
                const indexStr = indexArg !== undefined ? ` INDEX ${indexArg}` : "";
                const failStr = details.length > 0 ? ` (${details.join(", ")})` : "";
                const actualPermStr = actualPerms.length > 0 ? `[${actualPerms.join('')}]` : '[no perms]';
                return `TPERM CR${crIdx} ${actualPermStr} "${cr.name}" need [${maskStr}]${indexStr} -> ${result}${failStr} (Z=${this.flags.Z ? 1 : 0}, size=${objectSize})`;
            }
            
            case "B": {
                const [cond, offset] = args;
                if (this.checkCondition(cond)) {
                    this.nia = offset;
                    return `Branch${cond ? ' (' + cond + ')' : ''} taken to ${offset}`;
                }
                return `Branch${cond ? ' (' + cond + ')' : ''} not taken (condition false)`;
            }
            
            case "BL": {
                const [offset] = args;
                this.dataRegs[7] = BigInt(this.nia + 1);
                this.nia = offset;
                return `Branch with Link to ${offset}, return addr ${this.nia + 1} saved to DR7`;
            }
            
            case "LOAD": {
                const [destCR, srcCR, idx] = args;
                const src = srcCR < 8 ? this.contextRegs[srcCR] : 
                           srcCR === 8 ? this.cr8 : this.cr15;
                
                if (!src || src.name === 'NULL') {
                    return `FAULT: CR${srcCR} [NULL] - no capability loaded`;
                }
                if (!src.perms.includes('L') && !src.perms.includes('M')) {
                    const permStr = src.perms.length > 0 ? `[${src.perms.join('')}]` : '[no perms]';
                    return `FAULT: Source CR${srcCR} ${permStr} "${src.name}" lacks Load (L) or Master (M) permission`;
                }
                
                // Get the capability from source's clist at given index
                let loadedCap = null;
                if (src.clist && idx < src.clist.length) {
                    const entry = src.clist[idx];
                    loadedCap = {
                        name: entry.name || `Entry_${idx}`,
                        location: entry.location || { type: 'Local', offset: idx * 256 },
                        perms: entry.perms ? [...entry.perms] : ['R'],
                        locked: entry.locked || false,
                        goldenKey: entry.goldenKey || this.generateKey(),
                        clist: entry.clist || null
                    };
                } else {
                    // No clist or index out of bounds - create empty capability
                    loadedCap = {
                        name: `LOADED_${idx}`,
                        location: { type: 'Local', offset: idx * 256 },
                        perms: ['R'],
                        locked: false,
                        goldenKey: this.generateKey()
                    };
                }
                
                if (destCR < 8) {
                    this.contextRegs[destCR] = loadedCap;
                } else if (destCR === 8) {
                    this.cr8 = loadedCap;
                } else if (destCR === 15) {
                    this.cr15 = loadedCap;
                }
                
                const destName = destCR === 8 ? 'CR8 (Thread)' : destCR === 15 ? 'CR15 (Namespace)' : `CR${destCR}`;
                const permStr = loadedCap.perms.length > 0 ? `[${loadedCap.perms.join('')}]` : '';
                return `Loaded ${loadedCap.name} ${permStr} into ${destName} via CR${srcCR}[${idx}]`;
            }
            
            case "SAVE": {
                const [destCR, srcCR, idx] = args;
                const dest = destCR < 8 ? this.contextRegs[destCR] : 
                            destCR === 8 ? this.cr8 : this.cr15;
                const src = srcCR < 8 ? this.contextRegs[srcCR] : 
                           srcCR === 8 ? this.cr8 : this.cr15;
                
                if (!dest || dest.name === 'NULL') {
                    return `FAULT: CR${destCR} [NULL] - no capability loaded (destination)`;
                }
                if (!src || src.name === 'NULL') {
                    return `FAULT: CR${srcCR} [NULL] - no capability loaded (source)`;
                }
                if (!dest.perms.includes('S') && !dest.perms.includes('M')) {
                    const permStr = dest.perms.length > 0 ? `[${dest.perms.join('')}]` : '[no perms]';
                    return `FAULT: Dest CR${destCR} ${permStr} "${dest.name}" lacks Save (S) or Master (M) permission`;
                }
                if (!src.perms.includes('B') && !src.perms.includes('M')) {
                    const permStr = src.perms.length > 0 ? `[${src.perms.join('')}]` : '[no perms]';
                    return `FAULT: Source CR${srcCR} ${permStr} "${src.name}" lacks Bind (B) or Master (M) permission`;
                }
                return `Saved GT from CR${srcCR} to CR${destCR}[${idx || 0}] (B-bit validated)`;
            }
            
            case "CALL": {
                const [crIdx, maskField] = args;
                const cr = crIdx < 8 ? this.contextRegs[crIdx] : 
                          crIdx === 8 ? this.cr8 : this.cr15;
                
                if (!cr || cr.name === 'NULL') {
                    return `FAULT: CR${crIdx} [NULL] - no capability loaded`;
                }
                if (!cr.perms.includes('E')) {
                    const permStr = cr.perms.length > 0 ? `[${cr.perms.join('')}]` : '[no perms]';
                    return `FAULT: Source CR${crIdx} ${permStr} "${cr.name}" lacks Enter (E) permission`;
                }
                
                this.callStack.push({
                    returnNIA: this.nia + 1,
                    cr6: this.contextRegs[6] ? { ...this.contextRegs[6] } : null,
                    cr7: this.contextRegs[7] ? { ...this.contextRegs[7] } : null,
                    boundGTs: []
                });
                
                const mask = maskField || 0;
                let clearedRegs = [];
                for (let i = 0; i < 16; i++) {
                    if ((mask >> i) & 1) {
                        this.dataRegs[i] = 0n;
                        clearedRegs.push(`DR${i}`);
                    }
                }
                
                const nodalPerms = [...cr.perms];
                if (!nodalPerms.includes('M')) {
                    nodalPerms.push('M');  // Append M after successful CALL
                }
                this.contextRegs[6] = {
                    name: `CLIST_${cr.name}`,
                    location: cr.location,
                    perms: nodalPerms,
                    locked: false,
                    goldenKey: this.generateKey(),
                    isNodalCList: true
                };
                
                this.contextRegs[7] = {
                    name: `ACCESS_${cr.name}`,
                    location: { type: 'Code', offset: 0 },
                    perms: ['X'],
                    locked: false,
                    goldenKey: this.generateKey()
                };
                
                this.stackDepth++;
                const clearMsg = clearedRegs.length > 0 ? `, cleared: ${clearedRegs.join(',')}` : '';
                return `CALL CR${crIdx} (${cr.name}): pushed frame, loaded CR6 (nodal C-List), CR7 (Access Code)${clearMsg}`;
            }
            
            case "RETURN": {
                if (this.stackDepth > 0 && this.callStack.length > 0) {
                    const frame = this.callStack.pop();
                    this.stackDepth--;
                    
                    if (frame.cr6) this.contextRegs[6] = frame.cr6;
                    if (frame.cr7) this.contextRegs[7] = frame.cr7;
                    
                    let surrendered = [];
                    for (let i = 0; i < 8; i++) {
                        const cr = this.contextRegs[i];
                        if (cr && cr.boundDuringCall) {
                            this.contextRegs[i] = { name: 'NULL', perms: [], location: null, locked: true };
                            surrendered.push(`CR${i}`);
                        }
                    }
                    
                    const surrenderMsg = surrendered.length > 0 ? `, surrendered bound GTs: ${surrendered.join(',')}` : '';
                    return `RETURN: restored CR6/CR7, stack depth: ${this.stackDepth}${surrenderMsg}`;
                }
                return `FAULT: Stack underflow - no procedure to return from`;
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
                
                if (!cr || cr.name === 'NULL') {
                    return `FAULT: CR${crIdx} [NULL] - no capability loaded`;
                }
                if (!cr.perms.includes('L') && !cr.perms.includes('E')) {
                    const permStr = cr.perms.length > 0 ? `[${cr.perms.join('')}]` : '[no perms]';
                    return `FAULT: CR${crIdx} ${permStr} "${cr.name}" lacks Load (L) or Enter (E) permission`;
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
