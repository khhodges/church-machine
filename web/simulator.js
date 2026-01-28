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
        
        // Per-thread exclusive monitors for LOADX/SAVEX (16 threads)
        this.exclusiveMonitors = {};
        for (let i = 0; i < 16; i++) {
            this.exclusiveMonitors[i] = { valid: false, addr: 0 };
        }
        this.currentThread = 0;
    }
    
    // TPERM preset codes: 0-5 data perms, 6-12 Lambda perms (L,S,E,B,M,F,G), 13 combo
    // Reserved codes 14-15 cause FAULT
    getTpermMask(code) {
        const presets = {
            0:  [],                              // CLEAR: No permissions
            1:  ['R'],                           // R: Read-only
            2:  ['R', 'W'],                      // RW: Read-Write
            3:  ['X'],                           // X: Execute only
            4:  ['R', 'X'],                      // RX: Read-Execute
            5:  ['R', 'W', 'X'],                 // RWX: Full data access
            6:  ['L'],                           // L: Load capability
            7:  ['S'],                           // S: Save capability
            8:  ['E'],                           // E: Enter abstraction
            9:  ['B'],                           // B: Bind (can delegate)
            10: ['M'],                           // M: Meta/internal
            11: ['F'],                           // F: Foreign/remote
            12: ['G'],                           // G: GC marking
            13: ['L', 'S'],                      // LS: Load + Save (common combo)
            14: null,                            // RESERVED - causes FAULT
            15: null                             // RESERVED - causes FAULT
        };
        return presets[code];
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
                
                const validPerms = ['R', 'W', 'X', 'L', 'S', 'E', 'B', 'M', 'F', 'G'];
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
                // Check if source is a Namespace entry (has M permission or is CR15)
                // In CTMM, Namespace entries have M permission - only these participate in GC
                const isNamespaceAccess = src.perms.includes('M') || srcCR === 15;
                if (src.clist && idx < src.clist.length) {
                    const entry = src.clist[idx];
                    // Reset G bit if set (deterministic garbage collection)
                    // Only incurs overhead when G=TRUE and accessing Namespace entry
                    // The L/M permission check above validates the key before this point
                    // This signals to software that a valid key exists for this entry
                    if (isNamespaceAccess && entry.perms && entry.perms.includes('G')) {
                        entry.perms = entry.perms.filter(p => p !== 'G');
                    }
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
            
            case "LOADX": {
                // Load Exclusive - same as LOAD but sets exclusive monitor
                const [destCR, srcCR, idx] = args;
                const src = srcCR < 8 ? this.contextRegs[srcCR] : 
                           srcCR === 8 ? this.cr8 : this.cr15;
                
                if (!src || src.name === 'NULL') {
                    return `FAULT: CR${srcCR} [NULL] - no capability loaded`;
                }
                if (!src.perms.includes('L') && !src.perms.includes('M')) {
                    const permStr = src.perms.length > 0 ? `[${src.perms.join('')}]` : '[no perms]';
                    return `FAULT: Source CR${srcCR} ${permStr} lacks Load (L) permission`;
                }
                
                // Load the capability (reuse LOAD logic)
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
                }
                
                // Set exclusive monitor for current thread
                const addr = (srcCR << 16) | idx;
                this.exclusiveMonitors[this.currentThread] = { valid: true, addr: addr };
                
                return `LOADX: Loaded ${loadedCap.name} into CR${destCR}, exclusive monitor set for addr 0x${addr.toString(16)}`;
            }
            
            case "SAVEX": {
                // Store Exclusive - conditional store, returns result in DR
                const [srcCR, destCR, idx, resultDR] = args;
                const dest = destCR < 8 ? this.contextRegs[destCR] : 
                            destCR === 8 ? this.cr8 : this.cr15;
                const src = srcCR < 8 ? this.contextRegs[srcCR] : 
                           srcCR === 8 ? this.cr8 : this.cr15;
                
                if (!dest || dest.name === 'NULL') {
                    return `FAULT: CR${destCR} [NULL] - no capability loaded (destination)`;
                }
                if (!dest.perms.includes('S') && !dest.perms.includes('M')) {
                    const permStr = dest.perms.length > 0 ? `[${dest.perms.join('')}]` : '[no perms]';
                    return `FAULT: Dest CR${destCR} ${permStr} lacks Save (S) permission`;
                }
                
                // Check exclusive monitor
                const addr = (destCR << 16) | idx;
                const monitor = this.exclusiveMonitors[this.currentThread];
                
                if (monitor.valid && monitor.addr === addr) {
                    // Success - monitor was valid
                    this.setDataReg(resultDR || 0, BigInt(0));
                    this.exclusiveMonitors[this.currentThread] = { valid: false, addr: 0 };
                    return `SAVEX: Success, saved CR${srcCR} to CR${destCR}[${idx}], DR${resultDR || 0}=0`;
                } else {
                    // Fail - monitor was cleared or different address
                    this.setDataReg(resultDR || 0, BigInt(1));
                    this.exclusiveMonitors[this.currentThread] = { valid: false, addr: 0 };
                    return `SAVEX: Failed (monitor invalid/mismatch), DR${resultDR || 0}=1`;
                }
            }
            
            case "LDM": {
                // Load Multiple - load multiple CRs from consecutive C-List entries
                const [baseCR, regList] = args;
                const base = baseCR < 8 ? this.contextRegs[baseCR] : 
                            baseCR === 8 ? this.cr8 : this.cr15;
                
                if (!base || base.name === 'NULL') {
                    return `FAULT: CR${baseCR} [NULL] - no capability loaded`;
                }
                if (!base.perms.includes('L') && !base.perms.includes('M')) {
                    const permStr = base.perms.length > 0 ? `[${base.perms.join('')}]` : '[no perms]';
                    return `FAULT: Base CR${baseCR} ${permStr} lacks Load (L) permission`;
                }
                
                let loaded = [];
                let idx = 0;
                for (let i = 0; i < 8; i++) {
                    if ((regList >> i) & 1) {
                        // Load CR[i] from base[idx]
                        if (base.clist && idx < base.clist.length) {
                            const entry = base.clist[idx];
                            this.contextRegs[i] = {
                                name: entry.name || `LDM_${idx}`,
                                location: entry.location || { type: 'Local', offset: idx * 256 },
                                perms: entry.perms ? [...entry.perms] : ['R'],
                                locked: false,
                                goldenKey: entry.goldenKey || this.generateKey()
                            };
                        }
                        loaded.push(`CR${i}`);
                        idx++;
                    }
                }
                return `LDM: Loaded {${loaded.join(',')}} from CR${baseCR}`;
            }
            
            case "STM": {
                // Store Multiple - store multiple CRs to consecutive C-List entries
                const [baseCR, regList] = args;
                const base = baseCR < 8 ? this.contextRegs[baseCR] : 
                            baseCR === 8 ? this.cr8 : this.cr15;
                
                if (!base || base.name === 'NULL') {
                    return `FAULT: CR${baseCR} [NULL] - no capability loaded`;
                }
                if (!base.perms.includes('S') && !base.perms.includes('M')) {
                    const permStr = base.perms.length > 0 ? `[${base.perms.join('')}]` : '[no perms]';
                    return `FAULT: Base CR${baseCR} ${permStr} lacks Save (S) permission`;
                }
                
                let stored = [];
                for (let i = 0; i < 8; i++) {
                    if ((regList >> i) & 1) {
                        stored.push(`CR${i}`);
                    }
                }
                return `STM: Stored {${stored.join(',')}} to CR${baseCR}`;
            }
            
            case "LDI": {
                // Load Immediate - load 22-bit constant into data register
                const [dr, imm] = args;
                const value = BigInt(imm) & BigInt(0x3FFFFF);  // 22-bit mask
                this.setDataReg(dr, value);
                return `LDI DR${dr}, #${imm} = 0x${value.toString(16).toUpperCase()}`;
            }
            
            case "TPERM_PRESET": {
                // TPERM with preset code instead of explicit permissions
                const [destCR, srcCR, presetCode] = args;
                
                const mask = this.getTpermMask(presetCode);
                if (mask === null) {
                    return `FAULT: TPERM preset code ${presetCode} is reserved (use 0-13)`;
                }
                
                const src = srcCR < 8 ? this.contextRegs[srcCR] : 
                           srcCR === 8 ? this.cr8 : this.cr15;
                
                if (!src || src.name === 'NULL') {
                    return `FAULT: CR${srcCR} [NULL] - no capability loaded`;
                }
                
                // Create new capability with restricted permissions
                const srcPerms = src.perms || [];
                const newPerms = mask.filter(p => srcPerms.includes(p));
                
                const newCap = {
                    name: src.name,
                    location: { ...src.location },
                    perms: newPerms,
                    locked: src.locked,
                    goldenKey: src.goldenKey
                };
                
                if (destCR < 8) {
                    this.contextRegs[destCR] = newCap;
                }
                
                return `TPERM_PRESET CR${destCR}, CR${srcCR}, #${presetCode}: [${srcPerms.join('')}] -> [${newPerms.join('')}]`;
            }
            
            case "CALL": {
                const [crIdx, maskField] = args;
                const cr = crIdx < 8 ? this.contextRegs[crIdx] : 
                          crIdx === 8 ? this.cr8 : this.cr15;
                
                if (!cr || cr.name === 'NULL') {
                    return `FAULT: CR${crIdx} [NULL] - no capability loaded`;
                }
                if (!cr.perms.includes('L')) {
                    const permStr = cr.perms.length > 0 ? `[${cr.perms.join('')}]` : '[no perms]';
                    return `FAULT: Source CR${crIdx} ${permStr} "${cr.name}" lacks Limit (L) permission for CALL`;
                }
                
                this.callStack.push({
                    returnNIA: this.nia + 1,
                    cr6: this.contextRegs[6] ? { ...this.contextRegs[6] } : null,
                    cr7: this.contextRegs[7] ? { ...this.contextRegs[7] } : null,
                    boundGTs: []
                });
                
                // CALL isolation mask (11 bits): [10:5]=CR0-5, [4:0]=DR1-5
                // bit=1 means PRESERVE, bit=0 means CLEAR
                // Fixed behaviors: DR0 always preserved, DR6-7 always cleared, DR8-15 always cleared
                const mask = maskField || 0;
                let clearedRegs = [];
                
                // DR0: always preserved (not in mask)
                // DR1-DR5: based on mask bits [4:0]
                for (let i = 1; i <= 5; i++) {
                    const preserve = (mask >> (i - 1)) & 1;
                    if (!preserve) {
                        this.dataRegs[i] = 0n;
                        clearedRegs.push(`DR${i}`);
                    }
                }
                // DR6-DR15: always cleared
                for (let i = 6; i < 16; i++) {
                    this.dataRegs[i] = 0n;
                    clearedRegs.push(`DR${i}`);
                }
                
                // CR0-CR5: based on mask bits [10:5]
                let clearedCRs = [];
                for (let i = 0; i <= 5; i++) {
                    const preserve = (mask >> (i + 5)) & 1;
                    if (!preserve) {
                        this.contextRegs[i] = { name: 'NULL', perms: [], location: null, locked: true };
                        clearedCRs.push(`CR${i}`);
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
                const drClearMsg = clearedRegs.length > 0 ? `, DRs cleared: ${clearedRegs.join(',')}` : '';
                const crClearMsg = clearedCRs.length > 0 ? `, CRs cleared: ${clearedCRs.join(',')}` : '';
                return `CALL CR${crIdx} (${cr.name}): pushed frame, loaded CR6 (nodal C-List), CR7 (Access Code)${drClearMsg}${crClearMsg}`;
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
                // CHANGE CRs (I=0) or CHANGE CRn, idx (I=1)
                // I=0: Create thread GT from capability in CRs
                // I=1: Create thread GT from C-List lookup
                const [arg1, arg2] = args;
                
                // Clear exclusive monitor on thread change (ARM CLREX semantics)
                this.exclusiveMonitors[this.currentThread] = { valid: false, addr: 0 };
                
                let sourceCap = null;
                let sourceDesc = '';
                
                if (arg2 !== undefined) {
                    // I=1: C-List lookup - arg1 is CRn, arg2 is index
                    const crIdx = parseInt(arg1);
                    const index = parseInt(arg2);
                    const clist = crIdx < 8 ? this.contextRegs[crIdx] : null;
                    if (!clist || clist.name === 'NULL') {
                        return `FAULT: CR${crIdx} [NULL] - no C-List loaded`;
                    }
                    if (!clist.perms.includes('L')) {
                        return `FAULT: CR${crIdx} lacks Load (L) permission for C-List access`;
                    }
                    // Actually look up the entry from the C-List
                    if (!clist.clist || index >= clist.clist.length) {
                        return `FAULT: Index ${index} out of bounds for C-List (size: ${clist.clist ? clist.clist.length : 0})`;
                    }
                    const entry = clist.clist[index];
                    // Validate entry permissions (L or E required to read capability)
                    if (entry.perms && !entry.perms.includes('L') && !entry.perms.includes('E') && !entry.perms.includes('R')) {
                        return `FAULT: Entry ${index} lacks required permissions for access`;
                    }
                    sourceCap = {
                        name: entry.name || `Entry_${index}`,
                        location: entry.location || { type: 'Local', offset: index * 256 },
                        perms: entry.perms ? [...entry.perms] : ['R'],
                        locked: entry.locked || false,
                        goldenKey: entry.goldenKey || this.generateKey(),
                        clist: entry.clist || null
                    };
                    sourceDesc = `C-List CR${crIdx}[${index}]`;
                } else {
                    // I=0: Register source - arg1 is CRs
                    const crIdx = parseInt(arg1);
                    sourceCap = crIdx < 8 ? this.contextRegs[crIdx] : 
                               crIdx === 8 ? this.cr8 : this.cr15;
                    if (!sourceCap || sourceCap.name === 'NULL') {
                        return `FAULT: CR${crIdx} [NULL] - no capability loaded`;
                    }
                    sourceDesc = `CR${crIdx}`;
                }
                
                // Create new thread GT from source capability
                this.cr8 = {
                    name: `THREAD_${sourceCap.name}`,
                    location: sourceCap.location || { type: 'Local', offset: 0 },
                    perms: ['R', 'W'],
                    locked: false,
                    goldenKey: this.generateKey()
                };
                return `CHANGE: Created thread GT from ${sourceDesc}, exclusive monitor cleared`;
            }
            
            case "SWITCH": {
                // SWITCH CRs, target (I=0) or SWITCH CRn, idx, target (I=1)
                // I=0: Copy capability from CRs to system register CR8-CR15
                // I=1: Load from C-List[idx] to system register CR8-CR15
                // Target: 0=CR8, 1=CR9, 2=CR10, 3-6=CR11-14 (future), 7=CR15
                const [arg1, arg2, arg3] = args;
                
                let sourceCap = null;
                let sourceDesc = '';
                let target = 7; // Default to CR15 for backward compatibility
                
                if (arg3 !== undefined) {
                    // I=1: C-List lookup - arg1 is CRn, arg2 is index, arg3 is target
                    const crIdx = parseInt(arg1);
                    const index = parseInt(arg2);
                    target = parseInt(arg3);
                    const clist = crIdx < 8 ? this.contextRegs[crIdx] : null;
                    if (!clist || clist.name === 'NULL') {
                        return `FAULT: CR${crIdx} [NULL] - no C-List loaded`;
                    }
                    if (!clist.perms.includes('L')) {
                        return `FAULT: CR${crIdx} lacks Load (L) permission for C-List access`;
                    }
                    // Actually look up the entry from the C-List
                    if (!clist.clist || index >= clist.clist.length) {
                        return `FAULT: Index ${index} out of bounds for C-List (size: ${clist.clist ? clist.clist.length : 0})`;
                    }
                    const entry = clist.clist[index];
                    // Validate entry permissions (L or E required to read capability)
                    if (entry.perms && !entry.perms.includes('L') && !entry.perms.includes('E') && !entry.perms.includes('R')) {
                        return `FAULT: Entry ${index} lacks required permissions for access`;
                    }
                    sourceCap = {
                        name: entry.name || `Entry_${index}`,
                        location: entry.location || { type: 'Local', offset: index * 256 },
                        perms: entry.perms ? [...entry.perms] : ['R'],
                        locked: entry.locked || false,
                        goldenKey: entry.goldenKey || this.generateKey(),
                        clist: entry.clist || null
                    };
                    sourceDesc = `C-List CR${crIdx}[${index}]`;
                } else {
                    // I=0: Register source - arg1 is CRs, arg2 is target
                    const crIdx = parseInt(arg1);
                    target = arg2 !== undefined ? parseInt(arg2) : 7;
                    sourceCap = crIdx < 8 ? this.contextRegs[crIdx] : 
                               crIdx === 8 ? this.cr8 : this.cr15;
                    if (!sourceCap || sourceCap.name === 'NULL') {
                        return `FAULT: CR${crIdx} [NULL] - no capability loaded`;
                    }
                    if (!sourceCap.perms.includes('L') && !sourceCap.perms.includes('E')) {
                        const permStr = sourceCap.perms.length > 0 ? `[${sourceCap.perms.join('')}]` : '[no perms]';
                        return `FAULT: CR${crIdx} ${permStr} "${sourceCap.name}" lacks Load (L) or Enter (E) permission`;
                    }
                    sourceDesc = `CR${crIdx}`;
                }
                
                // Map target to destination system register (CR8 + target)
                const destCR = 8 + target;
                const destName = ['CR8 (Thread)', 'CR9 (Interrupt)', 'CR10 (DFault)', 
                                  'CR11', 'CR12', 'CR13', 'CR14', 'CR15 (Namespace)'][target];
                const newCap = { ...sourceCap, goldenKey: sourceCap.goldenKey || this.generateKey() };
                
                // Store to appropriate system register
                if (destCR === 8) {
                    this.cr8 = newCap;
                } else if (destCR === 15) {
                    this.cr15 = newCap;
                } else {
                    // CR9-14: Store in system register array (future use)
                    if (!this.systemRegs) this.systemRegs = {};
                    this.systemRegs[destCR] = newCap;
                }
                
                // Clear exclusive monitor on thread change (target=0 is CR8/Thread)
                if (target === 0) {
                    this.exclusiveMonitors[this.currentThread] = { valid: false, addr: 0 };
                }
                
                return `SWITCH: Loaded ${sourceDesc} into ${destName}`;
            }
            
            default:
                return `Unknown instruction: ${instr}`;
        }
    }
    
    // ============================================
    // Garbage Collection - Hierarchical DNA Scan
    // ============================================
    
    // Generate a unique ID for cycle detection
    gcGetObjectId(obj, index, parentPath) {
        if (obj.goldenKey) return obj.goldenKey;
        if (obj.nsOffset !== undefined) return `ns:${obj.nsOffset}`;
        return `${parentPath}:${index}:${obj.name || 'unnamed'}`;
    }
    
    // Check if object has valid key access (L or M permission)
    hasValidKeyAccess(parent) {
        if (!parent || !parent.perms) return false;
        return parent.perms.includes('L') || parent.perms.includes('M');
    }
    
    // Mark phase: Set G=TRUE on all entries in the Namespace hierarchy
    gcMark(namespace, visited = new Set(), path = '') {
        if (!namespace || !namespace.clist) return 0;
        
        const objId = this.gcGetObjectId(namespace, 0, path);
        if (visited.has(objId)) return 0;
        visited.add(objId);
        
        let marked = 0;
        
        for (let i = 0; i < namespace.clist.length; i++) {
            const entry = namespace.clist[i];
            if (entry && entry.perms) {
                // Add G bit if not already present
                if (!entry.perms.includes('G')) {
                    entry.perms.push('G');
                    marked++;
                }
                // Recursively mark nested namespaces (DNA hierarchy)
                if (entry.clist) {
                    marked += this.gcMark(entry, visited, `${path}/${namespace.name || 'root'}`);
                }
            }
        }
        return marked;
    }
    
    // Scan phase: Walk hierarchy from root, simulating valid key access
    // Each access resets G to FALSE (same as LOAD with valid key)
    // Only clears G if parent has L or M permission (valid key check)
    gcScan(namespace, visited = new Set(), path = '') {
        if (!namespace || !namespace.clist) return 0;
        
        const objId = this.gcGetObjectId(namespace, 0, path);
        if (visited.has(objId)) return 0;
        visited.add(objId);
        
        // Check if parent has valid key access (L or M permission)
        const isNamespaceEntry = namespace.perms && 
            (namespace.perms.includes('M') || namespace.perms.includes('L'));
        
        let scanned = 0;
        
        for (let i = 0; i < namespace.clist.length; i++) {
            const entry = namespace.clist[i];
            if (entry && entry.perms) {
                // Valid key access resets G bit only if parent has L or M permission
                // This simulates the LOAD behavior where valid key access clears G
                if (isNamespaceEntry && entry.perms.includes('G')) {
                    entry.perms = entry.perms.filter(p => p !== 'G');
                    scanned++;
                }
                // Recursively scan nested namespaces (DNA hierarchy)
                if (entry.clist) {
                    scanned += this.gcScan(entry, visited, `${path}/${namespace.name || 'root'}`);
                }
            }
        }
        return scanned;
    }
    
    // Sweep phase: Find entries still marked with G (no valid key touched them)
    gcSweep(namespace, visited = new Set(), path = '') {
        if (!namespace || !namespace.clist) return [];
        
        const objId = this.gcGetObjectId(namespace, 0, path);
        if (visited.has(objId)) return [];
        visited.add(objId);
        
        const garbage = [];
        
        for (let i = 0; i < namespace.clist.length; i++) {
            const entry = namespace.clist[i];
            if (entry && entry.perms) {
                const entryPath = `${path}/${entry.name || i}`;
                // Still has G = no valid key accessed this entry
                if (entry.perms.includes('G')) {
                    garbage.push({
                        path: entryPath,
                        entry: entry
                    });
                }
                // Recursively check nested namespaces
                if (entry.clist) {
                    garbage.push(...this.gcSweep(entry, visited, entryPath));
                }
            }
        }
        return garbage;
    }
    
    // Full GC cycle: Mark → Scan from roots → Sweep unreachable
    gcCycle(roots) {
        const results = {
            phase: 'complete',
            marked: 0,
            scanned: 0,
            garbage: []
        };
        
        // If no roots provided, use CR15 (Namespace root)
        if (!roots) {
            roots = [this.cr15];
        }
        
        // Phase 1: Mark all entries in the namespace hierarchy with G=TRUE
        const markVisited = new Set();
        for (const root of roots) {
            results.marked += this.gcMark(root, markVisited, '');
        }
        
        // Phase 2: Scan from roots - valid key access resets G
        const scanVisited = new Set();
        for (const root of roots) {
            results.scanned += this.gcScan(root, scanVisited, '');
        }
        
        // Phase 3: Sweep - find entries where G is still TRUE (garbage)
        const sweepVisited = new Set();
        for (const root of roots) {
            results.garbage.push(...this.gcSweep(root, sweepVisited, ''));
        }
        
        return results;
    }
}

const simulator = new CTMMSimulator();
