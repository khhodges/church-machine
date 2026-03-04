class CLOOMCCompiler {
    constructor() {
        this.opcodes = {
            LOAD: 0, SAVE: 1, CALL: 2, RETURN: 3,
            CHANGE: 4, SWITCH: 5, TPERM: 6, LAMBDA: 7,
            ELOADCALL: 8, XLOADLAMBDA: 9,
            DREAD: 10, DWRITE: 11,
            BFEXT: 12, BFINS: 13,
            MCMP: 14, IADD: 15, ISUB: 16,
            BRANCH: 17, SHL: 18, SHR: 19,
        };
        this.conditions = {
            EQ: 0, NE: 1, CS: 2, CC: 3,
            MI: 4, PL: 5, VS: 6, VC: 7,
            HI: 8, LS: 9, GE: 10, LT: 11,
            GT: 12, LE: 13, AL: 14, NV: 15,
        };
        this.DR_ARGS_START = 0;
        this.DR_ARGS_END = 3;
        this.DR_LOCALS_START = 4;
        this.DR_LOCALS_END = 11;
        this.DR_TEMP_START = 12;
        this.DR_TEMP_END = 15;
    }

    encode(opcode, cond, dst, src, imm) {
        return (
            ((opcode & 0x1F) << 27) |
            ((cond & 0xF) << 23) |
            ((dst & 0xF) << 19) |
            ((src & 0xF) << 15) |
            (imm & 0x7FFF)
        ) >>> 0;
    }

    compile(source, capabilities) {
        const errors = [];
        const parsed = this._parseAbstraction(source, errors);
        if (errors.length > 0) {
            return { methods: [], errors, manifest: [] };
        }

        const rom = this._buildROM(parsed.capabilities, capabilities || []);
        const methods = [];
        const manifest = [];

        for (const method of parsed.methods) {
            const result = this._compileMethod(method, rom, parsed.capabilities);
            if (result.errors.length > 0) {
                errors.push(...result.errors);
            } else {
                methods.push({ name: method.name, code: result.code });
                manifest.push({ name: method.name, mapping: result.manifest });
            }
        }

        return { methods, errors, manifest, abstractionName: parsed.name, capabilities: parsed.capabilities || [] };
    }

    _buildROM(declaredCaps, uploadCaps) {
        const rom = {};
        const capNames = declaredCaps || [];
        for (let i = 0; i < capNames.length; i++) {
            rom[capNames[i].toUpperCase()] = i;
        }
        if (uploadCaps && uploadCaps.length > 0) {
            for (let i = 0; i < uploadCaps.length; i++) {
                const name = uploadCaps[i].name || uploadCaps[i].target;
                if (typeof name === 'string') {
                    rom[name.toUpperCase()] = i;
                }
            }
        }
        return rom;
    }

    _parseAbstraction(source, errors) {
        const result = { name: '', capabilities: [], methods: [] };
        const lines = source.split('\n');
        let i = 0;

        while (i < lines.length) {
            const line = lines[i].trim();
            if (!line || line.startsWith('//')) { i++; continue; }

            const absMatch = line.match(/^abstraction\s+(\w+)\s*\{/);
            if (absMatch) {
                result.name = absMatch[1];
                i++;
                i = this._parseAbstractionBody(lines, i, result, errors);
                break;
            }
            i++;
        }

        if (!result.name) {
            errors.push({ line: 0, message: 'No abstraction declaration found. Expected: abstraction Name { ... }' });
        }
        return result;
    }

    _parseAbstractionBody(lines, i, result, errors) {
        while (i < lines.length) {
            const line = lines[i].trim();
            if (!line || line.startsWith('//')) { i++; continue; }
            if (line === '}') return i + 1;

            const capMatch = line.match(/^capabilities\s*\{/);
            if (capMatch) {
                i++;
                while (i < lines.length) {
                    const capLine = lines[i].trim();
                    if (capLine === '}') { i++; break; }
                    if (capLine && !capLine.startsWith('//')) {
                        const names = capLine.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
                        result.capabilities.push(...names);
                    }
                    i++;
                }
                continue;
            }

            const methodMatch = line.match(/^method\s+(\w+)\s*\(([^)]*)\)\s*\{/);
            if (methodMatch) {
                const method = { name: methodMatch[1], params: [], body: [], startLine: i };
                if (methodMatch[2].trim()) {
                    method.params = methodMatch[2].split(',').map(p => p.trim()).filter(Boolean);
                }
                i++;
                let braceDepth = 1;
                while (i < lines.length && braceDepth > 0) {
                    const bodyLine = lines[i];
                    if (bodyLine.trim() === '{') braceDepth++;
                    else if (bodyLine.trim() === '}') {
                        braceDepth--;
                        if (braceDepth === 0) { i++; break; }
                    }
                    const trimmed = bodyLine.trim();
                    for (const ch of trimmed) {
                        if (ch === '{') braceDepth++;
                        else if (ch === '}') braceDepth--;
                    }
                    if (braceDepth > 0) {
                        method.body.push({ text: trimmed, lineNum: i });
                    } else {
                        const beforeClose = trimmed.replace(/\}$/, '').trim();
                        if (beforeClose) method.body.push({ text: beforeClose, lineNum: i });
                    }
                    i++;
                }
                result.methods.push(method);
                continue;
            }

            i++;
        }
        return i;
    }

    _compileMethod(method, rom, capNames) {
        const errors = [];
        const code = [];
        const manifest = [];
        const locals = {};
        let nextLocal = this.DR_LOCALS_START;

        for (const param of method.params) {
            const paramIdx = method.params.indexOf(param);
            if (paramIdx <= this.DR_ARGS_END) {
                locals[param] = paramIdx;
            } else {
                if (nextLocal > this.DR_LOCALS_END) {
                    errors.push({ line: method.startLine, message: `Too many parameters — max ${this.DR_LOCALS_END - this.DR_LOCALS_START + 1 + this.DR_ARGS_END + 1}` });
                    return { code: [], errors, manifest: [] };
                }
                locals[param] = nextLocal++;
            }
        }

        const labels = {};
        const labelRefs = [];

        for (const stmt of method.body) {
            if (!stmt.text || stmt.text.startsWith('//')) continue;

            const labelMatch = stmt.text.match(/^(\w+):$/);
            if (labelMatch) {
                labels[labelMatch[1]] = code.length;
                manifest.push({ src: stmt.lineNum, addr: code.length, desc: `label ${labelMatch[1]}` });
                continue;
            }

            this._compileStatement(stmt, code, locals, rom, capNames, labels, labelRefs, errors, manifest, method);
        }

        for (const ref of labelRefs) {
            const target = labels[ref.label];
            if (target === undefined) {
                errors.push({ line: ref.lineNum, message: `Undefined label: ${ref.label}` });
            } else {
                const offset = target & 0x7FFF;
                code[ref.addr] = (code[ref.addr] & ~0x7FFF) | offset;
                code[ref.addr] = code[ref.addr] >>> 0;
            }
        }

        return { code, errors, manifest };
    }

    _allocTemp(locals) {
        for (let r = this.DR_TEMP_START; r <= this.DR_TEMP_END; r++) {
            const used = Object.values(locals).includes(r);
            if (!used) return r;
        }
        return this.DR_TEMP_START;
    }

    _allocLocal(name, locals, errors, lineNum) {
        if (locals[name] !== undefined) return locals[name];
        for (let r = this.DR_LOCALS_START; r <= this.DR_LOCALS_END; r++) {
            const used = Object.values(locals).includes(r);
            if (!used) {
                locals[name] = r;
                return r;
            }
        }
        for (let r = this.DR_TEMP_START; r <= this.DR_TEMP_END; r++) {
            const used = Object.values(locals).includes(r);
            if (!used) {
                locals[name] = r;
                return r;
            }
        }
        errors.push({ line: lineNum, message: `Out of registers for variable '${name}'` });
        return 0;
    }

    _resolveExpr(expr, code, locals, rom, errors, lineNum, method) {
        expr = expr.trim();

        const numMatch = expr.match(/^(0x[0-9a-fA-F]+|\d+)$/);
        if (numMatch) {
            const val = parseInt(numMatch[1]);
            const dr = this._allocTemp(locals);
            if (val <= 0x7FFF) {
                code.push(this.encode(this.opcodes.IADD, 14, dr, 0, val));
            } else {
                code.push(this.encode(this.opcodes.IADD, 14, dr, 0, val & 0x7FFF));
                if (val > 0x7FFF) {
                    const hi = (val >>> 15) & 0x7FFF;
                    if (hi > 0) {
                        const t2 = dr === this.DR_TEMP_START ? this.DR_TEMP_START + 1 : this.DR_TEMP_START;
                        code.push(this.encode(this.opcodes.IADD, 14, t2, 0, hi));
                        code.push(this.encode(this.opcodes.SHL, 14, t2, t2, 15));
                        code.push(this.encode(this.opcodes.IADD, 14, dr, dr, 0));
                    }
                }
            }
            return dr;
        }

        if (locals[expr] !== undefined) {
            return locals[expr];
        }

        const addMatch = expr.match(/^(\w+)\s*\+\s*(.+)$/);
        if (addMatch) {
            const leftDR = this._resolveExpr(addMatch[1], code, locals, rom, errors, lineNum, method);
            const rightExpr = addMatch[2].trim();
            const rightNum = rightExpr.match(/^(0x[0-9a-fA-F]+|\d+)$/);
            if (rightNum) {
                const val = parseInt(rightNum[1]);
                const dr = this._allocTemp(locals);
                code.push(this.encode(this.opcodes.IADD, 14, dr, leftDR, val & 0x7FFF));
                return dr;
            }
            const rightDR = this._resolveExpr(rightExpr, code, locals, rom, errors, lineNum, method);
            const dr = this._allocTemp(locals);
            code.push(this.encode(this.opcodes.IADD, 14, dr, leftDR, 0));
            code.push(this.encode(this.opcodes.IADD, 14, dr, dr, 0));
            return dr;
        }

        const subMatch = expr.match(/^(\w+)\s*-\s*(.+)$/);
        if (subMatch) {
            const leftDR = this._resolveExpr(subMatch[1], code, locals, rom, errors, lineNum, method);
            const rightExpr = subMatch[2].trim();
            const rightNum = rightExpr.match(/^(0x[0-9a-fA-F]+|\d+)$/);
            if (rightNum) {
                const val = parseInt(rightNum[1]);
                const dr = this._allocTemp(locals);
                code.push(this.encode(this.opcodes.ISUB, 14, dr, leftDR, val & 0x7FFF));
                return dr;
            }
            const rightDR = this._resolveExpr(rightExpr, code, locals, rom, errors, lineNum, method);
            const dr = this._allocTemp(locals);
            code.push(this.encode(this.opcodes.ISUB, 14, dr, leftDR, 0));
            return dr;
        }

        const shlMatch = expr.match(/^(\w+)\s*<<\s*(\d+)$/);
        if (shlMatch) {
            const srcDR = this._resolveExpr(shlMatch[1], code, locals, rom, errors, lineNum, method);
            const dr = this._allocTemp(locals);
            code.push(this.encode(this.opcodes.SHL, 14, dr, srcDR, parseInt(shlMatch[2])));
            return dr;
        }

        const shrMatch = expr.match(/^(\w+)\s*>>\s*(\d+)$/);
        if (shrMatch) {
            const srcDR = this._resolveExpr(shrMatch[1], code, locals, rom, errors, lineNum, method);
            const dr = this._allocTemp(locals);
            code.push(this.encode(this.opcodes.SHR, 14, dr, srcDR, parseInt(shrMatch[2])));
            return dr;
        }

        const readMatch = expr.match(/^read\s*\(\s*(\w+)\s*,\s*(.+)\s*\)$/);
        if (readMatch) {
            const crName = readMatch[1].toUpperCase();
            const crIdx = this._parseCR(crName);
            const offsetExpr = readMatch[2].trim();
            const offset = parseInt(offsetExpr) || 0;
            const dr = this._allocTemp(locals);
            code.push(this.encode(this.opcodes.DREAD, 14, dr, crIdx, offset & 0x7FFF));
            return dr;
        }

        const bfextMatch = expr.match(/^bfext\s*\(\s*(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
        if (bfextMatch) {
            const srcDR = this._resolveExpr(bfextMatch[1], code, locals, rom, errors, lineNum, method);
            const pos = parseInt(bfextMatch[2]);
            const width = parseInt(bfextMatch[3]);
            const dr = this._allocTemp(locals);
            const imm = ((pos & 0x1F) << 5) | (width & 0x1F);
            code.push(this.encode(this.opcodes.BFEXT, 14, dr, srcDR, imm));
            return dr;
        }

        errors.push({ line: lineNum, message: `Cannot resolve expression: ${expr}` });
        return 0;
    }

    _parseCR(name) {
        const match = name.match(/^CR(\d+)$/);
        if (match) return parseInt(match[1]);
        if (name === 'CODE' || name === 'CR7') return 7;
        if (name === 'CLIST' || name === 'CR6') return 6;
        return 0;
    }

    _compileStatement(stmt, code, locals, rom, capNames, labels, labelRefs, errors, manifest, method) {
        const text = stmt.text.trim();
        if (!text || text.startsWith('//')) return;

        const returnMatch = text.match(/^return\s*\(\s*(.*?)\s*\)$/);
        if (returnMatch) {
            if (returnMatch[1]) {
                const parts = returnMatch[1].split(',').map(s => s.trim());
                for (let i = 0; i < parts.length && i <= this.DR_ARGS_END; i++) {
                    const valDR = this._resolveExpr(parts[i], code, locals, rom, errors, stmt.lineNum, method);
                    if (valDR !== i) {
                        code.push(this.encode(this.opcodes.IADD, 14, i, valDR, 0));
                    }
                }
            }
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: 'RETURN' });
            code.push(this.encode(this.opcodes.RETURN, 14, 0, 0, 0));
            return;
        }

        const writeMatch = text.match(/^write\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(.+)\s*\)$/);
        if (writeMatch) {
            const crIdx = this._parseCR(writeMatch[1].toUpperCase());
            const offset = parseInt(writeMatch[2]) || 0;
            const valDR = this._resolveExpr(writeMatch[3], code, locals, rom, errors, stmt.lineNum, method);
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: `DWRITE CR${crIdx}, ${offset}` });
            code.push(this.encode(this.opcodes.DWRITE, 14, valDR, crIdx, offset & 0x7FFF));
            return;
        }

        const bfinsMatch = text.match(/^bfins\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
        if (bfinsMatch) {
            const dstDR = this._resolveExpr(bfinsMatch[1], code, locals, rom, errors, stmt.lineNum, method);
            const valDR = this._resolveExpr(bfinsMatch[2], code, locals, rom, errors, stmt.lineNum, method);
            const pos = parseInt(bfinsMatch[3]);
            const width = parseInt(bfinsMatch[4]);
            const imm = ((pos & 0x1F) << 5) | (width & 0x1F);
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: `BFINS DR${dstDR}, DR${valDR}` });
            code.push(this.encode(this.opcodes.BFINS, 14, dstDR, valDR, imm));
            return;
        }

        const callMatch = text.match(/^(?:(\w+)\s*=\s*)?call\s*\(\s*(\w+)\.(\w+)\s*\(\s*(.*?)\s*\)\s*\)$/);
        if (callMatch) {
            const resultVar = callMatch[1] || null;
            const absName = callMatch[2].toUpperCase();
            const methodName = callMatch[3];
            const argStr = callMatch[4];

            const clistOffset = rom[absName];
            if (clistOffset === undefined) {
                errors.push({ line: stmt.lineNum, message: `Unknown abstraction '${callMatch[2]}' — not in capabilities list. Available: ${Object.keys(rom).join(', ')}` });
                return;
            }

            if (argStr) {
                const args = argStr.split(',').map(s => s.trim());
                for (let a = 0; a < args.length && a <= this.DR_ARGS_END; a++) {
                    const argDR = this._resolveExpr(args[a], code, locals, rom, errors, stmt.lineNum, method);
                    if (argDR !== a) {
                        code.push(this.encode(this.opcodes.IADD, 14, a, argDR, 0));
                    }
                }
            }

            manifest.push({ src: stmt.lineNum, addr: code.length, desc: `LOAD CR0, [CR6 + ${clistOffset}] (${callMatch[2]})` });
            code.push(this.encode(this.opcodes.LOAD, 14, 0, 6, clistOffset));
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: `CALL CR0 -> ${callMatch[2]}.${methodName}` });
            code.push(this.encode(this.opcodes.CALL, 14, 0, 0, 0));

            if (resultVar) {
                const dr = this._allocLocal(resultVar, locals, errors, stmt.lineNum);
                if (dr !== 0) {
                    code.push(this.encode(this.opcodes.IADD, 14, dr, 0, 0));
                }
            }
            return;
        }

        const assignMatch = text.match(/^(?:var\s+)?(\w+)\s*=\s*(.+)$/);
        if (assignMatch) {
            const varName = assignMatch[1];
            const expr = assignMatch[2].trim();
            const dr = this._allocLocal(varName, locals, errors, stmt.lineNum);
            const valDR = this._resolveExpr(expr, code, locals, rom, errors, stmt.lineNum, method);
            if (valDR !== dr) {
                manifest.push({ src: stmt.lineNum, addr: code.length, desc: `${varName} = DR${valDR}` });
                code.push(this.encode(this.opcodes.IADD, 14, dr, valDR, 0));
            } else {
                manifest.push({ src: stmt.lineNum, addr: code.length - 1, desc: `${varName} = expr (in-place)` });
            }
            return;
        }

        const ifMatch = text.match(/^if\s*\(\s*(\w+)\s*(==|!=|<|>|<=|>=)\s*(\w+)\s*\)\s*\{$/);
        if (ifMatch) {
            const leftDR = this._resolveExpr(ifMatch[1], code, locals, rom, errors, stmt.lineNum, method);
            const rightDR = this._resolveExpr(ifMatch[3], code, locals, rom, errors, stmt.lineNum, method);
            code.push(this.encode(this.opcodes.MCMP, 14, leftDR, rightDR, 0));

            let branchCond;
            switch (ifMatch[2]) {
                case '==': branchCond = this.conditions.NE; break;
                case '!=': branchCond = this.conditions.EQ; break;
                case '<':  branchCond = this.conditions.GE; break;
                case '>':  branchCond = this.conditions.LE; break;
                case '<=': branchCond = this.conditions.GT; break;
                case '>=': branchCond = this.conditions.LT; break;
                default:   branchCond = this.conditions.AL; break;
            }

            const branchAddr = code.length;
            code.push(this.encode(this.opcodes.BRANCH, branchCond, 0, 0, 0));
            labelRefs.push({ addr: branchAddr, label: `__endif_${branchAddr}`, lineNum: stmt.lineNum });
            labels[`__endif_${branchAddr}`] = -1;
            manifest.push({ src: stmt.lineNum, addr: branchAddr, desc: `if (${ifMatch[1]} ${ifMatch[2]} ${ifMatch[3]})` });
            return;
        }

        if (text === '}') {
            const pendingLabels = Object.keys(labels).filter(l => l.startsWith('__endif_') && labels[l] === -1);
            if (pendingLabels.length > 0) {
                const label = pendingLabels[pendingLabels.length - 1];
                labels[label] = code.length;
            }
            return;
        }

        const whileMatch = text.match(/^while\s*\(\s*(\w+)\s*(==|!=|<|>|<=|>=)\s*(\w+)\s*\)\s*\{$/);
        if (whileMatch) {
            const loopStart = code.length;
            labels[`__while_start_${loopStart}`] = loopStart;
            const leftDR = this._resolveExpr(whileMatch[1], code, locals, rom, errors, stmt.lineNum, method);
            const rightDR = this._resolveExpr(whileMatch[3], code, locals, rom, errors, stmt.lineNum, method);
            code.push(this.encode(this.opcodes.MCMP, 14, leftDR, rightDR, 0));

            let branchCond;
            switch (whileMatch[2]) {
                case '==': branchCond = this.conditions.NE; break;
                case '!=': branchCond = this.conditions.EQ; break;
                case '<':  branchCond = this.conditions.GE; break;
                case '>':  branchCond = this.conditions.LE; break;
                case '<=': branchCond = this.conditions.GT; break;
                case '>=': branchCond = this.conditions.LT; break;
                default:   branchCond = this.conditions.AL; break;
            }

            const branchAddr = code.length;
            code.push(this.encode(this.opcodes.BRANCH, branchCond, 0, 0, 0));
            labelRefs.push({ addr: branchAddr, label: `__while_end_${loopStart}`, lineNum: stmt.lineNum });
            labels[`__while_end_${loopStart}`] = -1;
            labels[`__while_loop_${loopStart}`] = loopStart;
            manifest.push({ src: stmt.lineNum, addr: branchAddr, desc: `while (${whileMatch[1]} ${whileMatch[2]} ${whileMatch[3]})` });
            return;
        }

        const gotoMatch = text.match(/^goto\s+(\w+)$/);
        if (gotoMatch) {
            const branchAddr = code.length;
            code.push(this.encode(this.opcodes.BRANCH, this.conditions.AL, 0, 0, 0));
            labelRefs.push({ addr: branchAddr, label: gotoMatch[1], lineNum: stmt.lineNum });
            manifest.push({ src: stmt.lineNum, addr: branchAddr, desc: `goto ${gotoMatch[1]}` });
            return;
        }

        errors.push({ line: stmt.lineNum, message: `Cannot compile statement: ${text}` });
    }
}
