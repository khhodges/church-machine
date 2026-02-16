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
        
        this.lambdaActive = false;
        this.lambdaReturnNIA = 0;
        
        this.namespaceRegistry = {};
        this.nextVersion = 1;
        
        this.exclusiveMonitors = {};
        for (let i = 0; i < 16; i++) {
            this.exclusiveMonitors[i] = { valid: false, addr: 0 };
        }
        this.currentThread = 0;
    }
    
    // TPERM preset codes: 0-5 data perms, 6-8 Lambda perms (L,S,E), 9-11 combos
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
            9:  ['L', 'S'],                      // LS: Load + Save (common combo)
            10: ['L', 'S', 'E'],                 // LSE: Full Lambda access
            11: ['R', 'W', 'X', 'L', 'S', 'E'], // ALL: All 6 permissions
            12: ['E', 'L'],                      // EL: Enter + Load
            13: ['E', 'S'],                      // ES: Enter + Save
            14: null,                            // RESERVED - causes FAULT
            15: null                             // RESERVED - causes FAULT
        };
        return presets[code];
    }
    
    softReset() {
        this.dataRegs = {};
        for (let i = 0; i < 16; i++) {
            this.dataRegs[i] = BigInt(0);
        }
        
        this.nia = 0;
        this.stackDepth = 0;
        this.callStack = [];
        
        this.flags = { N: false, Z: false, C: false, V: false };
        this.lambdaActive = false;
        this.lambdaReturnNIA = 0;
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
        const cap = {
            name: name,
            location: { type: "Local", offset: Math.floor(Math.random() * 1000) },
            perms: perms,
            locked: false
        };
        this.registerCapability(cap);
        return cap;
    }

    generateKey() {
        let key = '';
        for (let i = 0; i < 48; i++) {
            key += Math.floor(Math.random() * 16).toString(16).toUpperCase();
        }
        return key.match(/.{1,8}/g).join('-');
    }

    computeMAC(cap) {
        const str = `${cap.name}:${cap.goldenKey || ''}:${cap.version || 0}:${JSON.stringify(cap.location)}`;
        let hash = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = (hash * 0x01000193) >>> 0;
        }
        return hash;
    }

    registerCapability(cap) {
        if (!cap.goldenKey) cap.goldenKey = this.generateKey();
        if (cap.version === undefined) {
            cap.version = this.nextVersion++;
        }
        cap.seal = this.computeMAC(cap);
        this.namespaceRegistry[cap.goldenKey] = cap.version;
        return cap;
    }

    bumpVersion(cap) {
        if (!cap.goldenKey) return;
        cap.version = this.nextVersion++;
        cap.seal = this.computeMAC(cap);
        this.namespaceRegistry[cap.goldenKey] = cap.version;
    }

    mLoad(src, requiredPerm, idx, microcode = false) {
        if (!src || src.name === 'NULL') {
            return { ok: false, fault: 'NULL', message: 'no capability loaded' };
        }

        if (requiredPerm !== null && requiredPerm !== undefined) {
            const hasM = src.perms.includes('M') || microcode;
            if (!hasM && !src.perms.includes(requiredPerm)) {
                return { ok: false, fault: 'PERMISSION', message: `lacks ${requiredPerm} permission` };
            }
        }

        if (src.goldenKey && src.version !== undefined) {
            const currentVersion = this.namespaceRegistry[src.goldenKey];
            if (currentVersion !== undefined && src.version !== currentVersion) {
                return { ok: false, fault: 'VERSION', message: `version mismatch: cap has ${src.version}, registry has ${currentVersion} (entry recycled)` };
            }
        }

        if (src.seal !== undefined && src.goldenKey) {
            const expectedMAC = this.computeMAC(src);
            if (src.seal !== expectedMAC) {
                return { ok: false, fault: 'MAC', message: 'MAC seal validation failed (capability tampered)' };
            }
        }

        if (idx !== undefined && idx !== null) {
            if (!src.clist || idx >= src.clist.length) {
                return { ok: false, fault: 'BOUNDS', message: `index ${idx} out of bounds for C-List (size: ${src.clist ? src.clist.length : 0})` };
            }
            const entry = src.clist[idx];

            if (entry.goldenKey && entry.version !== undefined) {
                const entryVersion = this.namespaceRegistry[entry.goldenKey];
                if (entryVersion !== undefined && entry.version !== entryVersion) {
                    return { ok: false, fault: 'VERSION', message: `entry ${idx}: version mismatch (entry recycled)` };
                }
            }

            if (entry.seal !== undefined && entry.goldenKey) {
                const expectedMAC = this.computeMAC(entry);
                if (entry.seal !== expectedMAC) {
                    return { ok: false, fault: 'MAC', message: `entry ${idx}: MAC seal validation failed` };
                }
            }

            const loadedCap = {
                name: entry.name || `Entry_${idx}`,
                location: entry.location || { type: 'Local', offset: idx * 256 },
                perms: entry.perms ? [...entry.perms] : ['R'],
                locked: entry.locked || false,
                goldenKey: entry.goldenKey || this.generateKey(),
                version: entry.version,
                seal: entry.seal,
                clist: entry.clist || null
            };

            return { ok: true, cap: loadedCap, entry };
        }

        return { ok: true, cap: src };
    }

    _getCR(crIdx) {
        if (crIdx < 8) return this.contextRegs[crIdx];
        if (crIdx === 8) return this.cr8;
        if (crIdx === 15) return this.cr15;
        return this.systemRegs ? this.systemRegs[crIdx] : null;
    }

    _setCR(crIdx, cap) {
        if (cap && cap.name !== 'NULL' && !cap.goldenKey) {
            this.registerCapability(cap);
        }
        if (crIdx < 8) this.contextRegs[crIdx] = cap;
        else if (crIdx === 8) this.cr8 = cap;
        else if (crIdx === 15) this.cr15 = cap;
        else {
            if (!this.systemRegs) this.systemRegs = {};
            this.systemRegs[crIdx] = cap;
        }
        this._updateThreadShadow(crIdx);
    }

    _clearCR(crIdx) {
        this._setCR(crIdx, this.createNullCapability());
    }

    _updateThreadShadow(crIdx) {
        if (crIdx > 7) return;
        if (!this.cr8 || this.cr8.name === 'NULL') return;
        if (!this.threadShadow) this.threadShadow = {};
        const tid = this.currentThread;
        if (!this.threadShadow[tid]) {
            this.threadShadow[tid] = { cr: {}, dr: {}, nia: this.nia };
            for (let i = 0; i < 8; i++) this.threadShadow[tid].cr[i] = this.createNullCapability();
            for (let i = 0; i < 16; i++) this.threadShadow[tid].dr[i] = 0n;
        }
        this.threadShadow[tid].cr[crIdx] = { ...this._getCR(crIdx) };
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
                
                const validPerms = ['R', 'W', 'X', 'L', 'S', 'E'];
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
                const src = this._getCR(srcCR);
                const result = this.mLoad(src, 'L', idx, true);
                if (!result.ok) {
                    return `FAULT: ${result.fault}: CR${srcCR} - ${result.message}`;
                }
                this._setCR(destCR, result.cap);
                const destName = destCR === 8 ? 'CR8 (Thread)' : destCR === 15 ? 'CR15 (Namespace)' : `CR${destCR}`;
                const permStr = result.cap.perms.length > 0 ? `[${result.cap.perms.join('')}]` : '';
                return `mLoad M↑: Loaded ${result.cap.name} ${permStr} into ${destName} via CR${srcCR}[${idx}]`;
            }
            
            case "SAVE": {
                const [destCR, srcCR, idx] = args;
                const dest = this._getCR(destCR);
                const src = this._getCR(srcCR);
                if (!dest || dest.name === 'NULL') {
                    return `FAULT: NULL: CR${destCR} - no capability loaded (destination C-List)`;
                }
                if (!src || src.name === 'NULL') {
                    return `FAULT: NULL: CR${srcCR} - no capability loaded (source)`;
                }
                const hasMDest = dest.perms.includes('M');
                if (!hasMDest && !dest.perms.includes('S')) {
                    return `FAULT: PERMISSION: CR${destCR} - lacks S permission (destination C-List)`;
                }
                const saveIdx = idx || 0;
                if (!dest.clist) {
                    dest.clist = [];
                }
                if (saveIdx < 0) {
                    return `FAULT: BOUNDS: index ${saveIdx} out of bounds`;
                }
                while (dest.clist.length <= saveIdx) {
                    dest.clist.push(this.createNullCapability());
                }
                const savedPerms = src.perms ? [...src.perms] : [];
                const savedCap = {
                    name: src.name || `Saved_${srcCR}`,
                    location: src.location,
                    perms: [...savedPerms],
                    locked: src.locked || false,
                    goldenKey: src.goldenKey || this.generateKey(),
                    clist: src.clist || null
                };
                this.registerCapability(savedCap);
                dest.clist[saveIdx] = savedCap;
                this._setCR(destCR, dest);
                return `SAVE: Stored CR${srcCR} (${src.name}) into CR${destCR} C-List[${saveIdx}] (S validated, sealed)`;
            }
            
            case "LOADX": {
                const [destCR, srcCR, idx] = args;
                const src = this._getCR(srcCR);
                const result = this.mLoad(src, 'L', idx, true);
                if (!result.ok) {
                    return `FAULT: ${result.fault}: CR${srcCR} - ${result.message}`;
                }
                this._setCR(destCR, result.cap);
                const addr = (srcCR << 16) | idx;
                this.exclusiveMonitors[this.currentThread] = { valid: true, addr: addr };
                return `mLoad M↑: LOADX ${result.cap.name} into CR${destCR}, exclusive monitor set`;
            }
            
            case "SAVEX": {
                const [srcCR, destCR, idx, resultDR] = args;
                const dest = destCR < 8 ? this.contextRegs[destCR] : destCR === 8 ? this.cr8 : this.cr15;
                const destResult = this.mLoad(dest, 'S', undefined, true);
                if (!destResult.ok) {
                    return `FAULT: ${destResult.fault}: CR${destCR} - ${destResult.message}`;
                }
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
                const [baseCR, regList] = args;
                const base = this._getCR(baseCR);
                const baseResult = this.mLoad(base, 'L', undefined, true);
                if (!baseResult.ok) {
                    return `FAULT: ${baseResult.fault}: CR${baseCR} - ${baseResult.message}`;
                }
                let loaded = [];
                let idx = 0;
                for (let i = 0; i < 8; i++) {
                    if ((regList >> i) & 1) {
                        const entryResult = this.mLoad(base, 'L', idx, true);
                        if (entryResult.ok) {
                            this._setCR(i, entryResult.cap);
                        }
                        loaded.push(`CR${i}`);
                        idx++;
                    }
                }
                return `LDM: Loaded {${loaded.join(',')}} from CR${baseCR}`;
            }
            
            case "STM": {
                const [baseCR, regList] = args;
                const base = baseCR < 8 ? this.contextRegs[baseCR] : baseCR === 8 ? this.cr8 : this.cr15;
                const baseResult = this.mLoad(base, 'S', undefined, true);
                if (!baseResult.ok) {
                    return `FAULT: ${baseResult.fault}: CR${baseCR} - ${baseResult.message}`;
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
            
            case "LAMBDA": {
                const [crIdx, drIdx] = args;
                const cr = this._getCR(crIdx);
                
                if (!cr || cr.name === 'NULL') {
                    return `FAULT: NULL: CR${crIdx} - no capability loaded`;
                }
                
                const typeField = cr.gtType || 0;
                if (typeField === 2) {
                    return `FAULT: TYPE: CR${crIdx} - NULL GT type (cannot LAMBDA)`;
                }
                if (typeField === 1) {
                    return `FAULT: TYPE: CR${crIdx} - Outform GT (LAMBDA requires local Inform)`;
                }
                
                if (!cr.perms.includes('X')) {
                    return `FAULT: PERMISSION: CR${crIdx} "${cr.name}" - lacks X permission (LAMBDA requires X)`;
                }
                
                if (this.lambdaActive) {
                    return `FAULT: LAMBDA: non-nestable - LAMBDA already active (use CALL to nest)`;
                }
                
                this.lambdaActive = true;
                this.lambdaReturnNIA = this.nia + 1;
                
                const argVal = this.getDataReg(drIdx || 0);
                const funcName = cr.name;
                let resultVal = argVal;
                let computeDesc = '';
                
                if (funcName === 'GT_CHURCH_SUCC' || funcName.includes('SUCC')) {
                    resultVal = argVal + 1n;
                    computeDesc = `SUCC(${argVal}) = ${resultVal}`;
                } else if (funcName === 'GT_CHURCH_PRED' || funcName.includes('PRED')) {
                    resultVal = argVal > 0n ? argVal - 1n : 0n;
                    computeDesc = `PRED(${argVal}) = ${resultVal}`;
                } else if (funcName === 'GT_CHURCH_ADD' || funcName.includes('ADD')) {
                    const b = this.getDataReg(1);
                    resultVal = argVal + b;
                    computeDesc = `ADD(${argVal}, ${b}) = ${resultVal}`;
                } else if (funcName === 'GT_CHURCH_MUL' || funcName.includes('MUL')) {
                    const b = this.getDataReg(1);
                    resultVal = argVal * b;
                    computeDesc = `MUL(${argVal}, ${b}) = ${resultVal}`;
                } else if (funcName === 'GT_TRUE' || funcName.includes('TRUE')) {
                    computeDesc = `TRUE(${argVal}, DR1) = ${argVal} (select first)`;
                } else if (funcName === 'GT_FALSE' || funcName.includes('FALSE')) {
                    resultVal = this.getDataReg(1);
                    computeDesc = `FALSE(DR0, ${resultVal}) = ${resultVal} (select second)`;
                } else if (funcName === 'GT_PAIR' || funcName.includes('PAIR')) {
                    const b = this.getDataReg(1);
                    computeDesc = `PAIR(${argVal}, ${b}) — paired in DR0,DR1`;
                } else if (funcName === 'GT_FST' || funcName.includes('FST')) {
                    computeDesc = `FST = ${argVal} (first of pair)`;
                } else if (funcName === 'GT_SND' || funcName.includes('SND')) {
                    resultVal = this.getDataReg(1);
                    computeDesc = `SND = ${resultVal} (second of pair)`;
                } else if (funcName === 'GT_IF' || funcName.includes('IF')) {
                    const cond = argVal !== 0n;
                    const thenVal = this.getDataReg(1);
                    const elseVal = this.getDataReg(2);
                    resultVal = cond ? thenVal : elseVal;
                    computeDesc = `IF(${argVal}, ${thenVal}, ${elseVal}) = ${resultVal}`;
                } else {
                    computeDesc = `λ ${funcName}(${argVal}) → applied`;
                }
                
                this.setDataReg(drIdx || 0, resultVal & BigInt("0xFFFFFFFFFFFFFFFF"));
                this.updateFlagsLogic(resultVal & BigInt("0xFFFFFFFFFFFFFFFF"));
                
                this.lambdaActive = false;
                
                return `LAMBDA CR${crIdx} DR${drIdx || 0}: X✓ → ${computeDesc}`;
            }
            
            case "CALL": {
                const [crIdx, maskField] = args;
                const cr = this._getCR(crIdx);
                const callResult = this.mLoad(cr, 'E', undefined, true);
                if (!callResult.ok) {
                    return `FAULT: ${callResult.fault}: CR${crIdx} - ${callResult.message}`;
                }

                if (cr && cr.type === "Outform") {
                    const drVals = [];
                    for (let i = 0; i <= 5; i++) drVals.push(Number(this.dataRegs[i]));
                    const msg = drVals.map(c => String.fromCharCode(c & 0x7F)).join('');
                    this.dataRegs[0] = 1n;
                    return `CALL CR${crIdx} (${cr.name}): [TUNNEL] Outform → encrypted tunnel to ${cr.remoteEndpoint || 'remote'}\n` +
                        `  Payload: DR0-DR5 = ${drVals.join(', ')} ("${msg}")\n` +
                        `  ABI mapping: DR0-DR15 (64-bit) → x0-x31 (32-bit)\n` +
                        `  Remote acknowledged — tunnel return. DR0 = 1 (ACK)`;
                }

                this.callStack.push({
                    returnNIA: this.nia,
                    cr6: this.contextRegs[6] ? { ...this.contextRegs[6] } : null,
                    cr7: this.contextRegs[7] ? { ...this.contextRegs[7] } : null,
                    boundGTs: []
                });
                
                const mask = maskField || 0;
                let clearedRegs = [];
                
                for (let i = 1; i <= 5; i++) {
                    const preserve = (mask >> (i - 1)) & 1;
                    if (!preserve) {
                        this.dataRegs[i] = 0n;
                        clearedRegs.push(`DR${i}`);
                    }
                }
                for (let i = 6; i < 16; i++) {
                    this.dataRegs[i] = 0n;
                    clearedRegs.push(`DR${i}`);
                }
                
                let clearedCRs = [];
                for (let i = 0; i <= 4; i++) {
                    const preserve = (mask >> (i + 5)) & 1;
                    if (!preserve) {
                        this._clearCR(i);
                        clearedCRs.push(`CR${i}`);
                    }
                }
                
                const nodalPerms = [...cr.perms];
                this._setCR(6, {
                    name: `CLIST_${cr.name}`,
                    location: cr.location,
                    perms: nodalPerms,
                    locked: false,
                    goldenKey: this.generateKey(),
                    isNodalCList: true
                });
                
                this._setCR(7, {
                    name: `ACCESS_${cr.name}`,
                    location: { type: 'Code', offset: 0 },
                    perms: ['X'],
                    locked: false,
                    goldenKey: this.generateKey(),
                    linkage: `${cr.name}/Nucleus.asm`
                });
                
                this.stackDepth++;
                const drClearMsg = clearedRegs.length > 0 ? `, DRs cleared: ${clearedRegs.join(',')}` : '';
                const crClearMsg = clearedCRs.length > 0 ? `, CRs cleared: ${clearedCRs.join(',')}` : '';
                return `CALL CR${crIdx} (${cr.name}): pushed frame, loaded CR6 (nodal C-List), CR7 (Access Code)${drClearMsg}${crClearMsg}`;
            }
            
            case "RETURN": {
                if (this.stackDepth > 0 && this.callStack.length > 0) {
                    const frame = this.callStack.pop();
                    this.stackDepth--;
                    
                    if (frame.cr6) {
                        if (!frame.cr6.perms || !frame.cr6.perms.includes('E')) {
                            return `FAULT: PERMISSION: RETURN: saved CR6 lacks E permission`;
                        }
                        const cr6Result = this.mLoad(frame.cr6, 'E', undefined, true);
                        if (!cr6Result.ok) {
                            return `FAULT: ${cr6Result.fault}: RETURN CR6 restore: ${cr6Result.message}`;
                        }
                        const cr6Restored = { ...cr6Result.cap };
                        this._setCR(6, cr6Restored);
                    } else {
                        this._clearCR(6);
                    }
                    
                    if (frame.cr7) {
                        const cr7Result = this.mLoad(frame.cr7, null, undefined, true);
                        if (!cr7Result.ok) {
                            return `FAULT: ${cr7Result.fault}: RETURN CR7 restore: ${cr7Result.message}`;
                        }
                        this._setCR(7, cr7Result.cap);
                    } else {
                        this._clearCR(7);
                    }
                    
                    let surrendered = [];
                    for (let i = 0; i < 8; i++) {
                        const cr = this.contextRegs[i];
                        if (cr && cr.boundDuringCall) {
                            this._clearCR(i);
                            surrendered.push(`CR${i}`);
                        }
                    }
                    
                    this.nia = frame.returnNIA + 1;
                    const surrenderMsg = surrendered.length > 0 ? `, surrendered bound GTs: ${surrendered.join(',')}` : '';
                    return `RETURN: restored CR6/CR7 via mLoad (CR5 stable), stack depth: ${this.stackDepth}${surrenderMsg}`;
                }
                return `FAULT: Stack underflow - no procedure to return from`;
            }
            
            case "CHANGE": {
                const [arg1, arg2] = args;

                this.exclusiveMonitors[this.currentThread] = { valid: false, addr: 0 };

                let sourceCap = null;
                let sourceDesc = '';

                if (arg2 !== undefined) {
                    const crIdx = parseInt(arg1);
                    const index = parseInt(arg2);
                    const clist = this._getCR(crIdx);
                    const result = this.mLoad(clist, 'L', index, true);
                    if (!result.ok) {
                        return `FAULT: ${result.fault}: CR${crIdx} - ${result.message}`;
                    }
                    sourceCap = result.cap;
                    sourceDesc = `C-List CR${crIdx}[${index}]`;
                } else {
                    const crIdx = parseInt(arg1);
                    const src = this._getCR(crIdx);
                    const result = this.mLoad(src, 'L', undefined, true);
                    if (!result.ok) {
                        return `FAULT: ${result.fault}: CR${crIdx} - ${result.message}`;
                    }
                    sourceCap = result.cap;
                    sourceDesc = `CR${crIdx}`;
                }

                this.callStack.push({
                    returnNIA: this.nia,
                    cr6: this.contextRegs[6] ? { ...this.contextRegs[6] } : null,
                    cr7: this.contextRegs[7] ? { ...this.contextRegs[7] } : null,
                });

                if (!this.threadShadow) this.threadShadow = {};
                const tid = this.currentThread;
                if (!this.threadShadow[tid]) {
                    this.threadShadow[tid] = { cr: {}, dr: {}, nia: this.nia };
                    for (let i = 0; i < 8; i++) this.threadShadow[tid].cr[i] = this.createNullCapability();
                    for (let i = 0; i < 16; i++) this.threadShadow[tid].dr[i] = 0n;
                }
                this.threadShadow[tid].dr = { ...this.dataRegs };
                this.threadShadow[tid].callStack = this.callStack.map(f => ({...f}));

                const targetId = sourceCap.name || sourceDesc;
                const target = this.threadShadow[targetId];

                if (target) {
                    for (let i = 0; i < 16; i++) {
                        this.dataRegs[i] = target.dr[i] !== undefined ? target.dr[i] : 0n;
                    }

                    if (target.callStack && target.callStack.length > 0) {
                        this.callStack = target.callStack.map(f => ({...f}));
                    } else {
                        this.callStack = [];
                    }

                    if (this.callStack.length > 0) {
                        const resumeFrame = this.callStack.pop();
                        this.stackDepth = this.callStack.length;

                        if (resumeFrame.cr5) {
                            const cr5Result = this.mLoad(resumeFrame.cr5, null, undefined, true);
                            if (cr5Result.ok) {
                                this._setCR(5, cr5Result.cap);
                            } else {
                                this._clearCR(5);
                            }
                        } else {
                            this._clearCR(5);
                        }

                        if (resumeFrame.cr6) {
                            const cr6Result = this.mLoad(resumeFrame.cr6, null, undefined, true);
                            if (!cr6Result.ok) {
                                return `FAULT: ${cr6Result.fault}: CHANGE restore CR6: ${cr6Result.message}`;
                            }
                            this._setCR(6, cr6Result.cap);
                        } else {
                            this._clearCR(6);
                        }

                        if (resumeFrame.cr7) {
                            const cr7Result = this.mLoad(resumeFrame.cr7, null, undefined, true);
                            if (!cr7Result.ok) {
                                return `FAULT: ${cr7Result.fault}: CHANGE restore CR7: ${cr7Result.message}`;
                            }
                            this._setCR(7, cr7Result.cap);
                        } else {
                            this._clearCR(7);
                        }

                        this.nia = resumeFrame.returnNIA + 1;
                    } else {
                        this.stackDepth = 0;
                        this.nia = (sourceCap.location && sourceCap.location.offset) || 0;
                    }
                } else {
                    for (let i = 0; i < 16; i++) this.dataRegs[i] = 0n;
                    this.callStack = [];
                    this.stackDepth = 0;
                    this.flags = { N: false, Z: false, C: false, V: false };
                    this.nia = (sourceCap.location && sourceCap.location.offset) || 0;
                }

                this._setCR(8, {
                    name: `THREAD_${sourceCap.name}`,
                    location: sourceCap.location || { type: 'Local', offset: 0 },
                    perms: sourceCap.perms || [],
                    locked: false,
                    goldenKey: sourceCap.goldenKey || this.generateKey(),
                    version: sourceCap.version,
                    seal: sourceCap.seal
                });
                this.currentThread = targetId;
                return `CHANGE: context switch from thread ${tid} to ${targetId} via ${sourceDesc}`;
            }
            
            case "SWITCH": {
                const [arg1, arg2, arg3] = args;
                
                let sourceCap = null;
                let sourceDesc = '';
                let target = 7;
                
                if (arg3 !== undefined) {
                    const crIdx = parseInt(arg1);
                    const index = parseInt(arg2);
                    target = parseInt(arg3);
                    const clist = this._getCR(crIdx);
                    const result = this.mLoad(clist, 'L', index, true);
                    if (!result.ok) {
                        return `FAULT: ${result.fault}: CR${crIdx} - ${result.message}`;
                    }
                    sourceCap = result.cap;
                    sourceDesc = `C-List CR${crIdx}[${index}]`;
                } else {
                    const crIdx = parseInt(arg1);
                    target = arg2 !== undefined ? parseInt(arg2) : 7;
                    const src = this._getCR(crIdx);
                    const resultL = this.mLoad(src, 'L', undefined, true);
                    const resultE = this.mLoad(src, 'E', undefined, true);
                    if (!resultL.ok && !resultE.ok) {
                        return `FAULT: ${resultL.fault}: CR${crIdx} - ${resultL.message}`;
                    }
                    sourceCap = src;
                    sourceDesc = `CR${crIdx}`;
                }
                
                const destCR = 8 + target;
                const destName = ['CR8 (Thread)', 'CR9 (Interrupt)', 'CR10 (DFault)', 
                                  'CR11', 'CR12', 'CR13', 'CR14', 'CR15 (Namespace)'][target];
                const newCap = { ...sourceCap, goldenKey: sourceCap.goldenKey || this.generateKey() };
                
                this._setCR(destCR, newCap);
                
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
    
    
    // Mark phase: Set gcMarked flag on all entries in the Namespace hierarchy
    // G is namespace metadata, not a GT permission bit
    gcMark(namespace, visited = new Set(), path = '') {
        if (!namespace || !namespace.clist) return 0;
        
        const objId = this.gcGetObjectId(namespace, 0, path);
        if (visited.has(objId)) return 0;
        visited.add(objId);
        
        let marked = 0;
        
        for (let i = 0; i < namespace.clist.length; i++) {
            const entry = namespace.clist[i];
            if (entry) {
                if (!entry.gcMarked) {
                    entry.gcMarked = true;
                    marked++;
                }
                if (entry.clist) {
                    marked += this.gcMark(entry, visited, `${path}/${namespace.name || 'root'}`);
                }
            }
        }
        return marked;
    }
    
    // Scan phase: Walk hierarchy from root, clearing gcMarked on all reachable entries
    // Reachability in the tree determines liveness, not parent permissions
    gcScan(namespace, visited = new Set(), path = '') {
        if (!namespace || !namespace.clist) return 0;
        
        const objId = this.gcGetObjectId(namespace, 0, path);
        if (visited.has(objId)) return 0;
        visited.add(objId);
        
        let scanned = 0;
        
        for (let i = 0; i < namespace.clist.length; i++) {
            const entry = namespace.clist[i];
            if (entry) {
                if (entry.gcMarked) {
                    entry.gcMarked = false;
                    scanned++;
                }
                if (entry.clist) {
                    scanned += this.gcScan(entry, visited, `${path}/${namespace.name || 'root'}`);
                }
            }
        }
        return scanned;
    }
    
    // Sweep phase: Find entries still marked (no valid key touched them)
    gcSweep(namespace, visited = new Set(), path = '') {
        if (!namespace || !namespace.clist) return [];
        
        const objId = this.gcGetObjectId(namespace, 0, path);
        if (visited.has(objId)) return [];
        visited.add(objId);
        
        const garbage = [];
        
        for (let i = 0; i < namespace.clist.length; i++) {
            const entry = namespace.clist[i];
            if (entry) {
                const entryPath = `${path}/${entry.name || i}`;
                if (entry.gcMarked) {
                    garbage.push({
                        path: entryPath,
                        entry: entry
                    });
                }
                if (entry.clist) {
                    garbage.push(...this.gcSweep(entry, visited, entryPath));
                }
            }
        }
        return garbage;
    }
    
    // PP250 Design: Mark-Scan-Sweep GC via DNA tree walk.
    // Mark: sets gcMarked flag on all entries in the namespace hierarchy.
    // Scan: walks the DNA tree from roots (CR15),
    //   clearing gcMarked on every reachable entry. All entries are reachable from
    //   CR15 root in the Sim-64 namespace hierarchy model.
    // Sweep: entries still marked are garbage (no valid key touched them).
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
