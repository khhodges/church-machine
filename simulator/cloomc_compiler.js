const FULL_ONLY_OPCODES = [4, 5, 7, 8, 9];
const FULL_ONLY_OPCODE_NAMES = { 4: 'CHANGE', 5: 'SWITCH', 7: 'LAMBDA', 8: 'ELOADCALL', 9: 'XLOADLAMBDA' };

function detectProfile(methods) {
    for (const m of methods) {
        if (!m.code) continue;
        for (const word of m.code) {
            const opcode = (word >>> 27) & 0x1F;
            if (FULL_ONLY_OPCODES.includes(opcode)) return 'Full';
        }
    }
    return 'IoT';
}

function detectProfileViolations(methods, manifest) {
    const violations = [];
    const manifestByMethod = {};
    if (manifest) {
        for (const entry of manifest) {
            if (entry.name && entry.mapping) {
                manifestByMethod[entry.name] = entry.mapping;
            }
        }
    }
    for (const m of methods) {
        if (!m.code) continue;
        const mapping = manifestByMethod[m.name] || [];
        for (let i = 0; i < m.code.length; i++) {
            const opcode = (m.code[i] >>> 27) & 0x1F;
            if (FULL_ONLY_OPCODES.includes(opcode)) {
                let srcLine = null;
                for (let j = mapping.length - 1; j >= 0; j--) {
                    if (mapping[j].addr <= i) { srcLine = mapping[j].src; break; }
                }
                violations.push({ method: m.name, offset: i, opcode, opcodeName: FULL_ONLY_OPCODE_NAMES[opcode], line: srcLine });
            }
        }
    }
    return violations;
}

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
        const targetDirective = this._parseTargetDirective(source);
        const cleanSource = source.replace(/^\s*@target\s+(IoT|Full)\s*$/im, '');
        let result;
        if (this._detectEnglish(cleanSource)) {
            result = this.compileEnglish(cleanSource, capabilities);
        } else if (this._detectLambda(cleanSource)) {
            result = this.compileLambda(cleanSource, capabilities);
        } else if (this._detectSymbolic(cleanSource)) {
            result = this.compileSymbolic(cleanSource, capabilities);
        } else if (this._detectHaskell(cleanSource)) {
            result = this.compileHaskell(cleanSource, capabilities);
        } else {
            result = this.compileJS(cleanSource, capabilities);
        }
        if (result.errors.length === 0 && result.methods.length > 0) {
            result.profile = detectProfile(result.methods);
            if (targetDirective) {
                result.targetDirective = targetDirective;
                if (targetDirective === 'IoT' && result.profile === 'Full') {
                    const violations = detectProfileViolations(result.methods, result.manifest);
                    for (const v of violations) {
                        const lineInfo = v.line != null ? v.line : '?';
                        result.errors.push({
                            line: lineInfo,
                            message: `@target IoT violation: method "${v.method}" uses Full-only opcode ${v.opcodeName} (opcode ${v.opcode}) at instruction offset ${v.offset}`
                        });
                    }
                }
            }
        } else if (result.errors.length === 0) {
            result.profile = 'IoT';
        }
        return result;
    }

    _parseTargetDirective(source) {
        const lines = source.split('\n');
        for (const line of lines) {
            const t = line.trim();
            if (!t || t.startsWith('//') || t.startsWith('--')) continue;
            const m = t.match(/^@target\s+(IoT|Full)\s*$/i);
            if (m) {
                const val = m[1].toLowerCase();
                return val === 'iot' ? 'IoT' : 'Full';
            }
            break;
        }
        return null;
    }

    compileJS(source, capabilities) {
        const errors = [];
        // Auto-wrap code that has no abstraction/method declaration
        if (!/^\s*abstraction\s+\w+/m.test(source)) {
            const hasMethod = /^\s*method\s+\w+/m.test(source);
            const nameMatch = source.match(/^\s*method\s+(\w+)/m);
            const autoName = nameMatch ? nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1) + 'Abstraction' : 'MyAbstraction';
            source = hasMethod
                ? `abstraction ${autoName} {\n${source}\n}`
                : `abstraction ${autoName} {\n    method run() {\n${source}\n    }\n}`;
        }
        const parsed = this._parseAbstraction(source, errors);
        if (errors.length > 0) {
            return { methods: [], errors, manifest: [], abstractionName: parsed.name || '', capabilities: parsed.capabilities || [], language: 'javascript' };
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

        return { methods, errors, manifest, abstractionName: parsed.name, capabilities: parsed.capabilities || [], language: 'javascript' };
    }

    _detectLambda(source) {
        const lines = source.split('\n');
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('--')) {
                if (/^--\s*LAMBDA\s+CALCULUS\s*$/i.test(t)) return true;
                continue;
            }
            if (/\u03BB[a-z]\s*\./.test(t)) return true;
            if (/^method\s+\w+\s*\([^)]*\)\s*=\s*.*\u03BB[a-z]\s*\./.test(t)) return true;
        }
        return false;
    }

    compileLambda(source, capabilities) {
        const errors = [];
        const parsed = this._parseLambdaAbstraction(source, errors);
        if (errors.length > 0) {
            return { methods: [], errors, manifest: [], abstractionName: parsed.name || '', capabilities: parsed.capabilities || [], language: 'lambda' };
        }

        const rom = this._buildROM(parsed.capabilities, capabilities || []);
        const methods = [];
        const manifest = [];

        for (const method of parsed.methods) {
            const result = this._compileLambdaMethod(method, rom, parsed.capabilities, errors);
            if (result.errors.length > 0) {
                errors.push(...result.errors);
            } else {
                methods.push({ name: method.name, code: result.code });
                manifest.push({ name: method.name, mapping: result.manifest });
            }
        }

        return { methods, errors, manifest, abstractionName: parsed.name, capabilities: parsed.capabilities || [], language: 'lambda' };
    }

    _parseLambdaAbstraction(source, errors) {
        const result = { name: '', capabilities: [], methods: [] };
        const lines = source.split('\n');
        let i = 0;

        while (i < lines.length) {
            const line = lines[i].trim();
            if (!line || line.startsWith('--')) { i++; continue; }

            const absMatch = line.match(/^abstraction\s+(\w+)\s*\{/);
            if (absMatch) {
                result.name = absMatch[1];
                i++;
                i = this._parseLambdaBody(lines, i, result, errors);
                break;
            }
            i++;
        }

        if (!result.name) {
            errors.push({ line: 0, message: 'No abstraction declaration found. Expected: abstraction Name { ... }' });
        }
        return result;
    }

    _parseLambdaBody(lines, i, result, errors) {
        while (i < lines.length) {
            const line = lines[i].trim();
            if (!line || line.startsWith('--')) { i++; continue; }
            if (line === '}') return i + 1;

            const capMatch = line.match(/^capabilities\s*\{/);
            if (capMatch) {
                const inlineMatch = line.match(/^capabilities\s*\{\s*(.*?)\s*\}$/);
                if (inlineMatch) {
                    if (inlineMatch[1]) {
                        const names = inlineMatch[1].replace(/,/g, ' ').split(/\s+/).filter(Boolean);
                        result.capabilities.push(...names);
                    }
                    i++;
                } else {
                    i++;
                    while (i < lines.length) {
                        const capLine = lines[i].trim();
                        if (capLine === '}') { i++; break; }
                        if (capLine && !capLine.startsWith('--')) {
                            const names = capLine.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
                            result.capabilities.push(...names);
                        }
                        i++;
                    }
                }
                continue;
            }

            const methodMatch = line.match(/^method\s+(\w+)\s*\(([^)]*)\)\s*=\s*(.+)$/);
            if (methodMatch) {
                const method = {
                    name: methodMatch[1],
                    params: methodMatch[2] ? methodMatch[2].split(',').map(p => p.trim()).filter(Boolean) : [],
                    expr: methodMatch[3].trim(),
                    startLine: i,
                    isLambda: true
                };
                i++;
                while (i < lines.length) {
                    const contLine = lines[i].trim();
                    if (!contLine || contLine.startsWith('--') || contLine.startsWith('method ') || contLine === '}') break;
                    method.expr += ' ' + contLine;
                    i++;
                }
                result.methods.push(method);
                continue;
            }

            const blockMethodMatch = line.match(/^method\s+(\w+)\s*\(([^)]*)\)\s*=\s*$/);
            if (blockMethodMatch) {
                const method = {
                    name: blockMethodMatch[1],
                    params: blockMethodMatch[2] ? blockMethodMatch[2].split(',').map(p => p.trim()).filter(Boolean) : [],
                    expr: '',
                    startLine: i,
                    isLambda: true
                };
                i++;
                while (i < lines.length) {
                    const contLine = lines[i].trim();
                    if (!contLine || contLine.startsWith('--')) { i++; continue; }
                    if (contLine.startsWith('method ') || contLine === '}') break;
                    method.expr += (method.expr ? ' ' : '') + contLine;
                    i++;
                }
                result.methods.push(method);
                continue;
            }

            i++;
        }
        return i;
    }

    _tokenizeLambda(input) {
        const tokens = [];
        let i = 0;
        while (i < input.length) {
            if (input[i] === ' ' || input[i] === '\t' || input[i] === '\n') { i++; continue; }

            if (input[i] === '\u03BB' || (input[i] === '\\' && i + 1 < input.length && /[a-z]/.test(input[i + 1]))) {
                tokens.push({ type: 'lambda', pos: i });
                i++;
                continue;
            }
            if (input[i] === '.') {
                tokens.push({ type: 'dot', pos: i });
                i++;
                continue;
            }
            if (input[i] === '(') { tokens.push({ type: 'lparen', pos: i }); i++; continue; }
            if (input[i] === ')') { tokens.push({ type: 'rparen', pos: i }); i++; continue; }
            if (input[i] === ',') { tokens.push({ type: 'comma', pos: i }); i++; continue; }
            if (input[i] === '+') { tokens.push({ type: 'op', value: '+', pos: i }); i++; continue; }
            if (input[i] === '-' && i + 1 < input.length) {
                if (/\d/.test(input[i + 1]) && (tokens.length === 0 || tokens[tokens.length - 1].type === 'op' || tokens[tokens.length - 1].type === 'dot' || tokens[tokens.length - 1].type === 'lambda')) {
                    let num = '-';
                    i++;
                    while (i < input.length && /\d/.test(input[i])) { num += input[i]; i++; }
                    tokens.push({ type: 'number', value: parseInt(num), pos: i });
                    continue;
                }
                tokens.push({ type: 'op', value: '-', pos: i }); i++; continue;
            }
            if (input[i] === '*') { tokens.push({ type: 'op', value: '*', pos: i }); i++; continue; }
            if (input[i] === '/') { tokens.push({ type: 'op', value: '/', pos: i }); i++; continue; }
            if (input.substring(i, i + 2) === '==') { tokens.push({ type: 'op', value: '==', pos: i }); i += 2; continue; }
            if (input.substring(i, i + 2) === '<=') { tokens.push({ type: 'op', value: '<=', pos: i }); i += 2; continue; }
            if (input.substring(i, i + 2) === '>=') { tokens.push({ type: 'op', value: '>=', pos: i }); i += 2; continue; }
            if (input[i] === '<') { tokens.push({ type: 'op', value: '<', pos: i }); i++; continue; }
            if (input[i] === '>') { tokens.push({ type: 'op', value: '>', pos: i }); i++; continue; }

            if (/\d/.test(input[i])) {
                let num = '';
                if (input[i] === '0' && i + 1 < input.length && input[i + 1] === 'x') {
                    num = '0x';
                    i += 2;
                    while (i < input.length && /[0-9a-fA-F]/.test(input[i])) { num += input[i]; i++; }
                } else {
                    while (i < input.length && /\d/.test(input[i])) { num += input[i]; i++; }
                }
                tokens.push({ type: 'number', value: parseInt(num), pos: i });
                continue;
            }

            if (/[a-zA-Z_]/.test(input[i])) {
                let ident = '';
                while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) { ident += input[i]; i++; }
                if (i < input.length && input[i] === '.' && /[A-Z]/.test(ident[0])) {
                    ident += '.';
                    i++;
                    while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) { ident += input[i]; i++; }
                }
                if (ident === 'let') tokens.push({ type: 'let', pos: i });
                else if (ident === 'in') tokens.push({ type: 'in', pos: i });
                else if (ident === 'if') tokens.push({ type: 'hif', pos: i });
                else if (ident === 'then') tokens.push({ type: 'then', pos: i });
                else if (ident === 'else') tokens.push({ type: 'helse', pos: i });
                else tokens.push({ type: 'ident', value: ident, pos: i });
                continue;
            }

            i++;
        }
        return tokens;
    }

    _parseLambdaExpr(input) {
        const tokens = this._tokenizeLambda(input.trim());
        if (tokens.length === 0) return { type: 'literal', value: 0 };
        return this._parseLambdaExprFromTokens(tokens, 0).node;
    }

    _parseLambdaExprFromTokens(tokens, pos) {
        if (pos >= tokens.length) return { node: { type: 'literal', value: 0 }, pos: pos };

        const t = tokens[pos];

        if (t.type === 'lambda') {
            const params = [];
            pos++;
            while (pos < tokens.length && tokens[pos].type === 'ident') {
                params.push(tokens[pos].value);
                pos++;
            }
            if (pos < tokens.length && tokens[pos].type === 'dot') pos++;
            const body = this._parseLambdaExprFromTokens(tokens, pos);
            return { node: { type: 'lambda', params: params, body: body.node }, pos: body.pos };
        }

        if (t.type === 'let') {
            pos++;
            const bindings = [];
            while (pos < tokens.length && tokens[pos].type !== 'in') {
                if (tokens[pos].type === 'ident') {
                    const name = tokens[pos].value;
                    pos++;
                    if (pos < tokens.length && tokens[pos].type === 'op' && (tokens[pos].value === '=' || tokens[pos].value === '==')) pos++;
                    const val = this._parseLambdaSimpleExpr(tokens, pos);
                    bindings.push({ name: name, value: val.node });
                    pos = val.pos;
                } else {
                    pos++;
                }
            }
            if (pos < tokens.length && tokens[pos].type === 'in') pos++;
            const body = this._parseLambdaExprFromTokens(tokens, pos);
            return { node: { type: 'let', bindings: bindings, body: body.node }, pos: body.pos };
        }

        if (t.type === 'hif') {
            pos++;
            const cond = this._parseLambdaSimpleExpr(tokens, pos);
            pos = cond.pos;
            if (pos < tokens.length && tokens[pos].type === 'then') pos++;
            const thenExpr = this._parseLambdaSimpleExpr(tokens, pos);
            pos = thenExpr.pos;
            if (pos < tokens.length && tokens[pos].type === 'helse') pos++;
            const elseExpr = this._parseLambdaExprFromTokens(tokens, pos);
            return { node: { type: 'ifExpr', cond: cond.node, thenBranch: thenExpr.node, elseBranch: elseExpr.node }, pos: elseExpr.pos };
        }

        return this._parseLambdaBinOp(tokens, pos);
    }

    _parseLambdaBinOp(tokens, pos) {
        let left = this._parseLambdaApp(tokens, pos);
        pos = left.pos;

        while (pos < tokens.length && tokens[pos].type === 'op') {
            const op = tokens[pos].value;
            pos++;
            const right = this._parseLambdaApp(tokens, pos);
            left = { node: { type: 'binop', op: op, left: left.node, right: right.node }, pos: right.pos };
            pos = right.pos;
        }

        return left;
    }

    _parseLambdaApp(tokens, pos) {
        let func = this._parseLambdaAtom(tokens, pos);
        pos = func.pos;

        while (pos < tokens.length) {
            const t = tokens[pos];
            if (t.type === 'number' || t.type === 'ident' || t.type === 'lparen') {
                const arg = this._parseLambdaAtom(tokens, pos);
                func = { node: { type: 'app', func: func.node, arg: arg.node }, pos: arg.pos };
                pos = arg.pos;
            } else {
                break;
            }
        }

        return func;
    }

    _parseLambdaAtom(tokens, pos) {
        if (pos >= tokens.length) return { node: { type: 'literal', value: 0 }, pos: pos };

        const t = tokens[pos];

        if (t.type === 'number') {
            return { node: { type: 'literal', value: t.value }, pos: pos + 1 };
        }

        if (t.type === 'ident') {
            return { node: { type: 'var', name: t.value }, pos: pos + 1 };
        }

        if (t.type === 'lparen') {
            pos++;
            if (pos < tokens.length && tokens[pos].type === 'rparen') {
                return { node: { type: 'literal', value: 0 }, pos: pos + 1 };
            }

            const inner = this._parseLambdaExprFromTokens(tokens, pos);
            pos = inner.pos;

            if (pos < tokens.length && tokens[pos].type === 'comma') {
                pos++;
                const second = this._parseLambdaExprFromTokens(tokens, pos);
                pos = second.pos;
                if (pos < tokens.length && tokens[pos].type === 'rparen') pos++;
                return { node: { type: 'pair', fst: inner.node, snd: second.node }, pos: pos };
            }

            if (pos < tokens.length && tokens[pos].type === 'rparen') pos++;
            return { node: inner.node, pos: pos };
        }

        if (t.type === 'lambda') {
            return this._parseLambdaExprFromTokens(tokens, pos);
        }

        return { node: { type: 'literal', value: 0 }, pos: pos + 1 };
    }

    _parseLambdaSimpleExpr(tokens, pos) {
        if (pos >= tokens.length) return { node: { type: 'literal', value: 0 }, pos: pos };

        const t = tokens[pos];

        if (t.type === 'lambda') {
            return this._parseLambdaExprFromTokens(tokens, pos);
        }

        if (t.type === 'let') {
            return this._parseLambdaExprFromTokens(tokens, pos);
        }

        if (t.type === 'hif') {
            return this._parseLambdaExprFromTokens(tokens, pos);
        }

        return this._parseLambdaBinOp(tokens, pos);
    }

    _compileLambdaMethod(method, rom, capNames, outerErrors) {
        const errors = [];
        const code = [];
        const manifest = [];
        const locals = {};
        let nextLocal = this.DR_LOCALS_START;

        for (let pi = 0; pi < method.params.length; pi++) {
            if (pi <= this.DR_ARGS_END) {
                locals[method.params[pi]] = pi;
            } else {
                if (nextLocal > this.DR_LOCALS_END) {
                    errors.push({ line: method.startLine, message: 'Too many parameters' });
                    return { code: [], errors, manifest: [] };
                }
                locals[method.params[pi]] = nextLocal++;
            }
        }

        const ast = this._parseLambdaExpr(method.expr);
        const resultReg = this._emitHaskellExpr(ast, code, locals, rom, capNames, errors, manifest, method.startLine);

        if (errors.length > 0) {
            return { code: [], errors, manifest: [] };
        }

        if (resultReg !== 0) {
            code.push(this.encode(this.opcodes.IADD, 14, 0, resultReg, 0));
        }
        manifest.push({ src: method.startLine, addr: code.length, desc: 'RETURN (implicit)' });
        code.push(this.encode(this.opcodes.RETURN, 14, 0, 0, 0));

        return { code, errors, manifest };
    }

    _detectHaskell(source) {
        const lines = source.split('\n');
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('--')) continue;
            if (t.match(/^method\s+\w+\s*\([^)]*\)\s*=\s*/)) return true;
            if (t.includes('\\') && t.includes('->')) return true;
            if (t.match(/\bcase\b.*\bof\b/)) return true;
            if (t.match(/\blet\b.*\bin\b/)) return true;
            if (t.match(/\bpure\b\s/)) return true;
        }
        return false;
    }

    _buildROM(declaredCaps, uploadCaps) {
        const rom = {};
        const capNames = declaredCaps || [];
        for (let i = 0; i < capNames.length; i++) {
            rom[capNames[i].toUpperCase()] = i + 1;
        }
        if (uploadCaps && uploadCaps.length > 0) {
            for (let i = 0; i < uploadCaps.length; i++) {
                const name = uploadCaps[i].name || uploadCaps[i].target;
                if (typeof name === 'string') {
                    rom[name.toUpperCase()] = i + 1;
                }
            }
        }
        return rom;
    }

    _parseAbstraction(source, errors) {
        // Auto-wrap code that has no abstraction declaration
        if (!/^\s*abstraction\s+\w+/m.test(source)) {
            const hasMethod = /^\s*method\s+\w+/m.test(source);
            const nameMatch = source.match(/^\s*method\s+(\w+)/m);
            const autoName = nameMatch ? nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1) + 'Abstraction' : 'MyAbstraction';
            if (hasMethod) {
                source = `abstraction ${autoName} {\n${source}\n}`;
            } else {
                // No method keyword either — wrap statements in method run()
                source = `abstraction ${autoName} {\n    method run() {\n${source}\n    }\n}`;
            }
        }
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
                const inlineMatch = line.match(/^capabilities\s*\{\s*(.*?)\s*\}$/);
                if (inlineMatch) {
                    if (inlineMatch[1]) {
                        const names = inlineMatch[1].replace(/,/g, ' ').split(/\s+/).filter(Boolean);
                        result.capabilities.push(...names);
                    }
                    i++;
                } else {
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
                    const trimmed = lines[i].trim();
                    if (trimmed === '}') {
                        braceDepth--;
                        if (braceDepth === 0) { i++; break; }
                        method.body.push({ text: trimmed, lineNum: i });
                        i++;
                        continue;
                    }
                    if (trimmed === '{') {
                        braceDepth++;
                        method.body.push({ text: trimmed, lineNum: i });
                        i++;
                        continue;
                    }
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
            if (target === undefined || target === -1) {
                errors.push({ line: ref.lineNum, message: `Undefined label: ${ref.label}` });
            } else {
                const relOffset = target - ref.addr;
                code[ref.addr] = (code[ref.addr] & ~0x7FFF) | (relOffset & 0x7FFF);
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
            if (val === 0) {
                code.push(this.encode(this.opcodes.IADD, 14, dr, 0, 0));
            } else if (val <= 0x3FFF) {
                code.push(this.encode(this.opcodes.IADD, 14, dr, 0, val | 0x4000));
            } else {
                const low = val & 0x3FFF;
                code.push(this.encode(this.opcodes.IADD, 14, dr, 0, low | 0x4000));
                const hi = val >>> 14;
                if (hi > 0) {
                    const t2 = dr === this.DR_TEMP_START ? this.DR_TEMP_START + 1 : this.DR_TEMP_START;
                    if (hi <= 0x3FFF) {
                        code.push(this.encode(this.opcodes.IADD, 14, t2, 0, hi | 0x4000));
                    } else {
                        code.push(this.encode(this.opcodes.IADD, 14, t2, 0, (hi & 0x3FFF) | 0x4000));
                    }
                    code.push(this.encode(this.opcodes.SHL, 14, t2, t2, 14));
                    code.push(this.encode(this.opcodes.IADD, 14, dr, dr, t2));
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
                if (val === 0) {
                    return leftDR;
                }
                if (val <= 0x3FFF) {
                    const dr = this._allocTemp(locals);
                    code.push(this.encode(this.opcodes.IADD, 14, dr, leftDR, val | 0x4000));
                    return dr;
                }
            }
            const rightDR = this._resolveExpr(rightExpr, code, locals, rom, errors, lineNum, method);
            const dr = this._allocTemp(locals);
            code.push(this.encode(this.opcodes.IADD, 14, dr, leftDR, rightDR));
            return dr;
        }

        const subMatch = expr.match(/^(\w+)\s*-\s*(.+)$/);
        if (subMatch) {
            const leftDR = this._resolveExpr(subMatch[1], code, locals, rom, errors, lineNum, method);
            const rightExpr = subMatch[2].trim();
            const rightNum = rightExpr.match(/^(0x[0-9a-fA-F]+|\d+)$/);
            if (rightNum) {
                const val = parseInt(rightNum[1]);
                if (val === 0) {
                    return leftDR;
                }
                if (val <= 0x3FFF) {
                    const dr = this._allocTemp(locals);
                    code.push(this.encode(this.opcodes.ISUB, 14, dr, leftDR, val | 0x4000));
                    return dr;
                }
            }
            const rightDR = this._resolveExpr(rightExpr, code, locals, rom, errors, lineNum, method);
            const dr = this._allocTemp(locals);
            code.push(this.encode(this.opcodes.ISUB, 14, dr, leftDR, rightDR));
            return dr;
        }

        const mulMatch = expr.match(/^(\w+)\s*\*\s*(.+)$/);
        if (mulMatch) {
            const leftDR = this._resolveExpr(mulMatch[1], code, locals, rom, errors, lineNum, method);
            const rightExpr = mulMatch[2].trim();
            const rightDR = this._resolveExpr(rightExpr, code, locals, rom, errors, lineNum, method);
            const accDR = this._allocTemp(locals);
            const cntDR = this._allocTemp(locals);
            const oneDR = this._allocTemp(locals);
            code.push(this.encode(this.opcodes.IADD, 14, accDR, 0, 0));
            code.push(this.encode(this.opcodes.IADD, 14, cntDR, rightDR, 0));
            code.push(this.encode(this.opcodes.IADD, 14, oneDR, 0, 0x4001));
            const loopStart = code.length;
            code.push(this.encode(this.opcodes.MCMP, 14, cntDR, 0, 0));
            const branchIdx = code.length;
            code.push(this.encode(this.opcodes.BRANCH, 0, 0, 0, 0));
            code.push(this.encode(this.opcodes.IADD, 14, accDR, accDR, leftDR));
            code.push(this.encode(this.opcodes.ISUB, 14, cntDR, cntDR, oneDR));
            const backOff = loopStart - code.length;
            code.push(this.encode(this.opcodes.BRANCH, 14, 0, 0, backOff & 0x7FFF));
            const fwdOff = code.length - branchIdx;
            code[branchIdx] = this.encode(this.opcodes.BRANCH, 0, 0, 0, fwdOff & 0x7FFF);
            return accDR;
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

        const readMatch = expr.match(/^(?:read|DREAD)\s*\(\s*(\w+)\s*,\s*(.+)\s*\)$/);
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
        if (name === 'CODE' || name === 'CR14') return 14;
        if (name === 'CLIST' || name === 'CR6') return 6;
        return 0;
    }

    _compileStatement(stmt, code, locals, rom, capNames, labels, labelRefs, errors, manifest, method) {
        const text = stmt.text.trim().replace(/;$/, '');
        if (!text || text.startsWith('//')) return;

        const returnMatch = text.match(/^(?:RETURN|return)\s*(?:\(\s*(.*?)\s*\))?$/);
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

        const writeMatch = text.match(/^(?:write|DWRITE)\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(.+)\s*\)$/);
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

        // recall() — re-call the current abstraction (CR6) directly → CALL CR6
        const recallMatch = text.match(/^recall\s*\(\s*(.*?)\s*\)$/);
        if (recallMatch) {
            const argStr = recallMatch[1];
            if (argStr) {
                const args = argStr.split(',').map(s => s.trim()).filter(Boolean);
                for (let a = 0; a < args.length && a <= this.DR_ARGS_END; a++) {
                    const argDR = this._resolveExpr(args[a], code, locals, rom, errors, stmt.lineNum, method);
                    if (argDR !== a) {
                        code.push(this.encode(this.opcodes.IADD, 14, a, argDR, 0));
                    }
                }
            }
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: 'CALL CR6 (recall self)' });
            code.push(this.encode(this.opcodes.CALL, 14, 6, 0, 0));
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

        const assignMatch = text.match(/^(?:(?:var|let|const)\s+)?(\w+)\s*=\s*(.+)$/);
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

        if (text === '} else {') {
            const pendingLabels = Object.keys(labels).filter(l => l.startsWith('__endif_') && labels[l] === -1);
            if (pendingLabels.length > 0) {
                const ifLabel = pendingLabels[pendingLabels.length - 1];
                const elseEndAddr = code.length;
                code.push(this.encode(this.opcodes.BRANCH, this.conditions.AL, 0, 0, 0));
                const elseLabel = `__endelse_${elseEndAddr}`;
                labelRefs.push({ addr: elseEndAddr, label: elseLabel, lineNum: stmt.lineNum });
                labels[elseLabel] = -1;
                labels[ifLabel] = code.length;
            }
            return;
        }

        if (text === '}') {
            const pendingWhile = Object.keys(labels).filter(l => l.startsWith('__while_end_') && labels[l] === -1);
            const pendingElse = Object.keys(labels).filter(l => l.startsWith('__endelse_') && labels[l] === -1);
            const pendingIf = Object.keys(labels).filter(l => l.startsWith('__endif_') && labels[l] === -1);

            const candidates = [
                ...pendingWhile.map(l => ({ label: l, type: 'while', idx: parseInt(l.replace('__while_end_', '')) })),
                ...pendingElse.map(l => ({ label: l, type: 'else', idx: parseInt(l.replace('__endelse_', '')) })),
                ...pendingIf.map(l => ({ label: l, type: 'if', idx: parseInt(l.replace('__endif_', '')) })),
            ];

            if (candidates.length > 0) {
                candidates.sort((a, b) => b.idx - a.idx);
                const innermost = candidates[0];

                if (innermost.type === 'while') {
                    const loopIdx = innermost.label.replace('__while_end_', '');
                    const loopStart = labels['__while_loop_' + loopIdx];
                    if (loopStart !== undefined) {
                        const backOffset = loopStart - code.length;
                        code.push(this.encode(this.opcodes.BRANCH, this.conditions.AL, 0, 0, backOffset & 0x7FFF));
                        manifest.push({ src: stmt.lineNum, addr: code.length - 1, desc: 'loop back to while' });
                    }
                    labels[innermost.label] = code.length;
                } else {
                    labels[innermost.label] = code.length;
                }
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

    compileHaskell(source, capabilities) {
        const errors = [];
        const parsed = this._parseHaskellAbstraction(source, errors);
        if (errors.length > 0) {
            return { methods: [], errors, manifest: [], abstractionName: parsed.name || '', capabilities: parsed.capabilities || [], language: 'haskell' };
        }

        const rom = this._buildROM(parsed.capabilities, capabilities || []);
        const methods = [];
        const manifest = [];

        for (const method of parsed.methods) {
            const result = this._compileHaskellMethod(method, rom, parsed.capabilities, errors);
            if (result.errors.length > 0) {
                errors.push(...result.errors);
            } else {
                methods.push({ name: method.name, code: result.code });
                manifest.push({ name: method.name, mapping: result.manifest });
            }
        }

        return { methods, errors, manifest, abstractionName: parsed.name, capabilities: parsed.capabilities || [], language: 'haskell' };
    }

    _parseHaskellAbstraction(source, errors) {
        const result = { name: '', capabilities: [], methods: [] };
        const lines = source.split('\n');
        let i = 0;

        while (i < lines.length) {
            const line = lines[i].trim();
            if (!line || line.startsWith('--')) { i++; continue; }

            const absMatch = line.match(/^abstraction\s+(\w+)\s*\{/);
            if (absMatch) {
                result.name = absMatch[1];
                i++;
                i = this._parseHaskellBody(lines, i, result, errors);
                break;
            }
            i++;
        }

        if (!result.name) {
            errors.push({ line: 0, message: 'No abstraction declaration found. Expected: abstraction Name { ... }' });
        }
        return result;
    }

    _parseHaskellBody(lines, i, result, errors) {
        while (i < lines.length) {
            const line = lines[i].trim();
            if (!line || line.startsWith('--')) { i++; continue; }
            if (line === '}') return i + 1;

            const capMatch = line.match(/^capabilities\s*\{/);
            if (capMatch) {
                const inlineMatch = line.match(/^capabilities\s*\{\s*(.*?)\s*\}$/);
                if (inlineMatch) {
                    if (inlineMatch[1]) {
                        const names = inlineMatch[1].replace(/,/g, ' ').split(/\s+/).filter(Boolean);
                        result.capabilities.push(...names);
                    }
                    i++;
                } else {
                    i++;
                    while (i < lines.length) {
                        const capLine = lines[i].trim();
                        if (capLine === '}') { i++; break; }
                        if (capLine && !capLine.startsWith('--')) {
                            const names = capLine.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
                            result.capabilities.push(...names);
                        }
                        i++;
                    }
                }
                continue;
            }

            const methodMatch = line.match(/^method\s+(\w+)\s*\(([^)]*)\)\s*=\s*(.+)$/);
            if (methodMatch) {
                const method = {
                    name: methodMatch[1],
                    params: methodMatch[2] ? methodMatch[2].split(',').map(p => p.trim()).filter(Boolean) : [],
                    expr: methodMatch[3].trim(),
                    startLine: i,
                    isLambda: true
                };
                i++;
                while (i < lines.length) {
                    const contLine = lines[i].trim();
                    if (!contLine || contLine.startsWith('--') || contLine.startsWith('method ') || contLine === '}') break;
                    method.expr += ' ' + contLine;
                    i++;
                }
                result.methods.push(method);
                continue;
            }

            const blockMethodMatch = line.match(/^method\s+(\w+)\s*\(([^)]*)\)\s*=\s*$/);
            if (blockMethodMatch) {
                const method = {
                    name: blockMethodMatch[1],
                    params: blockMethodMatch[2] ? blockMethodMatch[2].split(',').map(p => p.trim()).filter(Boolean) : [],
                    expr: '',
                    startLine: i,
                    isLambda: true
                };
                i++;
                while (i < lines.length) {
                    const contLine = lines[i].trim();
                    if (!contLine || contLine.startsWith('--')) { i++; continue; }
                    if (contLine.startsWith('method ') || contLine === '}') break;
                    method.expr += (method.expr ? ' ' : '') + contLine;
                    i++;
                }
                result.methods.push(method);
                continue;
            }

            i++;
        }
        return i;
    }

    _parseHaskellExpr(input) {
        const tokens = this._tokenizeHaskell(input.trim());
        if (tokens.length === 0) return { type: 'literal', value: 0 };
        return this._parseHaskellExprFromTokens(tokens, 0).node;
    }

    _tokenizeHaskell(input) {
        const tokens = [];
        let i = 0;
        while (i < input.length) {
            if (input[i] === ' ' || input[i] === '\t' || input[i] === '\n') { i++; continue; }

            if (input[i] === '\\') { tokens.push({ type: 'lambda', pos: i }); i++; continue; }
            if (input.substring(i, i + 2) === '->') { tokens.push({ type: 'arrow', pos: i }); i += 2; continue; }
            if (input[i] === '(') { tokens.push({ type: 'lparen', pos: i }); i++; continue; }
            if (input[i] === ')') { tokens.push({ type: 'rparen', pos: i }); i++; continue; }
            if (input[i] === ',') { tokens.push({ type: 'comma', pos: i }); i++; continue; }
            if (input[i] === '+') { tokens.push({ type: 'op', value: '+', pos: i }); i++; continue; }
            if (input[i] === '-' && i + 1 < input.length && input[i + 1] !== '>') {
                if (i + 1 < input.length && /\d/.test(input[i + 1]) && (tokens.length === 0 || tokens[tokens.length - 1].type === 'op' || tokens[tokens.length - 1].type === 'arrow' || tokens[tokens.length - 1].type === 'lambda')) {
                    let num = '-';
                    i++;
                    while (i < input.length && /\d/.test(input[i])) { num += input[i]; i++; }
                    tokens.push({ type: 'number', value: parseInt(num), pos: i });
                    continue;
                }
                tokens.push({ type: 'op', value: '-', pos: i }); i++; continue;
            }
            if (input[i] === '*') { tokens.push({ type: 'op', value: '*', pos: i }); i++; continue; }
            if (input.substring(i, i + 2) === '==') { tokens.push({ type: 'op', value: '==', pos: i }); i += 2; continue; }
            if (input.substring(i, i + 2) === '/=') { tokens.push({ type: 'op', value: '/=', pos: i }); i += 2; continue; }
            if (input.substring(i, i + 2) === '<=') { tokens.push({ type: 'op', value: '<=', pos: i }); i += 2; continue; }
            if (input.substring(i, i + 2) === '>=') { tokens.push({ type: 'op', value: '>=', pos: i }); i += 2; continue; }
            if (input[i] === '<') { tokens.push({ type: 'op', value: '<', pos: i }); i++; continue; }
            if (input[i] === '>') { tokens.push({ type: 'op', value: '>', pos: i }); i++; continue; }

            if (/\d/.test(input[i]) || (input[i] === '0' && input[i + 1] === 'x')) {
                let num = '';
                if (input[i] === '0' && i + 1 < input.length && input[i + 1] === 'x') {
                    num = '0x';
                    i += 2;
                    while (i < input.length && /[0-9a-fA-F]/.test(input[i])) { num += input[i]; i++; }
                } else {
                    while (i < input.length && /\d/.test(input[i])) { num += input[i]; i++; }
                }
                tokens.push({ type: 'number', value: parseInt(num), pos: i });
                continue;
            }

            if (/[a-zA-Z_]/.test(input[i])) {
                let ident = '';
                while (i < input.length && /[a-zA-Z0-9_.]/.test(input[i])) { ident += input[i]; i++; }
                if (ident === 'let') tokens.push({ type: 'let', pos: i });
                else if (ident === 'in') tokens.push({ type: 'in', pos: i });
                else if (ident === 'case') tokens.push({ type: 'case', pos: i });
                else if (ident === 'of') tokens.push({ type: 'of', pos: i });
                else if (ident === 'if') tokens.push({ type: 'hif', pos: i });
                else if (ident === 'then') tokens.push({ type: 'then', pos: i });
                else if (ident === 'else') tokens.push({ type: 'helse', pos: i });
                else if (ident === 'pure') tokens.push({ type: 'pure', pos: i });
                else tokens.push({ type: 'ident', value: ident, pos: i });
                continue;
            }

            if (input[i] === '_') { tokens.push({ type: 'ident', value: '_', pos: i }); i++; continue; }

            i++;
        }
        return tokens;
    }

    _parseHaskellExprFromTokens(tokens, pos) {
        if (pos >= tokens.length) return { node: { type: 'literal', value: 0 }, pos: pos };

        const t = tokens[pos];

        if (t.type === 'lambda') {
            const params = [];
            pos++;
            while (pos < tokens.length && tokens[pos].type === 'ident') {
                params.push(tokens[pos].value);
                pos++;
            }
            if (pos < tokens.length && tokens[pos].type === 'arrow') pos++;
            const body = this._parseHaskellExprFromTokens(tokens, pos);
            return { node: { type: 'lambda', params: params, body: body.node }, pos: body.pos };
        }

        if (t.type === 'let') {
            pos++;
            const bindings = [];
            while (pos < tokens.length && tokens[pos].type !== 'in') {
                if (tokens[pos].type === 'ident') {
                    const name = tokens[pos].value;
                    pos++;
                    if (pos < tokens.length && tokens[pos].type === 'op' && tokens[pos].value === '=') {
                        errors.push({ line: 0, message: 'let binding uses = not ==' });
                    }
                    if (pos < tokens.length && ((tokens[pos].type === 'op' && tokens[pos].value === '==') || (tokens[pos].type === 'op' && tokens[pos].value === '='))) pos++;
                    const val = this._parseHaskellSimpleExpr(tokens, pos);
                    bindings.push({ name: name, value: val.node });
                    pos = val.pos;
                } else {
                    pos++;
                }
            }
            if (pos < tokens.length && tokens[pos].type === 'in') pos++;
            const body = this._parseHaskellExprFromTokens(tokens, pos);
            return { node: { type: 'let', bindings: bindings, body: body.node }, pos: body.pos };
        }

        if (t.type === 'case') {
            pos++;
            const scrut = this._parseHaskellSimpleExpr(tokens, pos);
            pos = scrut.pos;
            if (pos < tokens.length && tokens[pos].type === 'of') pos++;
            const branches = [];
            while (pos < tokens.length) {
                if (tokens[pos].type === 'rparen') break;
                const pat = this._parseHaskellPattern(tokens, pos);
                pos = pat.pos;
                if (pos < tokens.length && tokens[pos].type === 'arrow') pos++;
                const body = this._parseHaskellSimpleExpr(tokens, pos);
                branches.push({ pattern: pat.node, body: body.node });
                pos = body.pos;
                if (pos < tokens.length && tokens[pos].type === 'comma') pos++;
            }
            return { node: { type: 'case', scrutinee: scrut.node, branches: branches }, pos: pos };
        }

        if (t.type === 'hif') {
            pos++;
            const cond = this._parseHaskellSimpleExpr(tokens, pos);
            pos = cond.pos;
            if (pos < tokens.length && tokens[pos].type === 'then') pos++;
            const thenExpr = this._parseHaskellSimpleExpr(tokens, pos);
            pos = thenExpr.pos;
            if (pos < tokens.length && tokens[pos].type === 'helse') pos++;
            const elseExpr = this._parseHaskellExprFromTokens(tokens, pos);
            return { node: { type: 'ifExpr', cond: cond.node, thenBranch: thenExpr.node, elseBranch: elseExpr.node }, pos: elseExpr.pos };
        }

        if (t.type === 'pure') {
            pos++;
            const val = this._parseHaskellSimpleExpr(tokens, pos);
            return { node: { type: 'pure', value: val.node }, pos: val.pos };
        }

        return this._parseHaskellBinOp(tokens, pos);
    }

    _parseHaskellBinOp(tokens, pos) {
        let left = this._parseHaskellApp(tokens, pos);
        pos = left.pos;

        while (pos < tokens.length && tokens[pos].type === 'op') {
            const op = tokens[pos].value;
            pos++;
            const right = this._parseHaskellApp(tokens, pos);
            left = { node: { type: 'binop', op: op, left: left.node, right: right.node }, pos: right.pos };
            pos = right.pos;
        }

        return left;
    }

    _parseHaskellApp(tokens, pos) {
        let func = this._parseHaskellAtom(tokens, pos);
        pos = func.pos;

        while (pos < tokens.length) {
            const t = tokens[pos];
            if (t.type === 'number' || t.type === 'ident' || t.type === 'lparen') {
                const arg = this._parseHaskellAtom(tokens, pos);
                func = { node: { type: 'app', func: func.node, arg: arg.node }, pos: arg.pos };
                pos = arg.pos;
            } else {
                break;
            }
        }

        return func;
    }

    _parseHaskellAtom(tokens, pos) {
        if (pos >= tokens.length) return { node: { type: 'literal', value: 0 }, pos: pos };

        const t = tokens[pos];

        if (t.type === 'number') {
            return { node: { type: 'literal', value: t.value }, pos: pos + 1 };
        }

        if (t.type === 'ident') {
            return { node: { type: 'var', name: t.value }, pos: pos + 1 };
        }

        if (t.type === 'lparen') {
            pos++;
            if (pos < tokens.length && tokens[pos].type === 'rparen') {
                return { node: { type: 'literal', value: 0 }, pos: pos + 1 };
            }

            const inner = this._parseHaskellExprFromTokens(tokens, pos);
            pos = inner.pos;

            if (pos < tokens.length && tokens[pos].type === 'comma') {
                pos++;
                const second = this._parseHaskellExprFromTokens(tokens, pos);
                pos = second.pos;
                if (pos < tokens.length && tokens[pos].type === 'rparen') pos++;
                return { node: { type: 'pair', fst: inner.node, snd: second.node }, pos: pos };
            }

            if (pos < tokens.length && tokens[pos].type === 'rparen') pos++;
            return { node: inner.node, pos: pos };
        }

        return { node: { type: 'literal', value: 0 }, pos: pos + 1 };
    }

    _parseHaskellPattern(tokens, pos) {
        if (pos >= tokens.length) return { node: { type: 'wildcard' }, pos: pos };

        const t = tokens[pos];
        if (t.type === 'number') {
            return { node: { type: 'litPat', value: t.value }, pos: pos + 1 };
        }
        if (t.type === 'ident') {
            if (t.value === '_') return { node: { type: 'wildcard' }, pos: pos + 1 };
            return { node: { type: 'varPat', name: t.value }, pos: pos + 1 };
        }
        return { node: { type: 'wildcard' }, pos: pos + 1 };
    }

    _parseHaskellSimpleExpr(tokens, pos) {
        if (pos >= tokens.length) return { node: { type: 'literal', value: 0 }, pos: pos };

        const t = tokens[pos];

        if (t.type === 'lambda') {
            return this._parseHaskellExprFromTokens(tokens, pos);
        }

        if (t.type === 'let') {
            return this._parseHaskellExprFromTokens(tokens, pos);
        }

        if (t.type === 'hif') {
            return this._parseHaskellExprFromTokens(tokens, pos);
        }

        return this._parseHaskellBinOp(tokens, pos);
    }

    _compileHaskellMethod(method, rom, capNames, outerErrors) {
        const errors = [];
        const code = [];
        const manifest = [];
        const locals = {};
        let nextLocal = this.DR_LOCALS_START;

        for (let pi = 0; pi < method.params.length; pi++) {
            if (pi <= this.DR_ARGS_END) {
                locals[method.params[pi]] = pi;
            } else {
                if (nextLocal > this.DR_LOCALS_END) {
                    errors.push({ line: method.startLine, message: 'Too many parameters' });
                    return { code: [], errors, manifest: [] };
                }
                locals[method.params[pi]] = nextLocal++;
            }
        }

        const ast = this._parseHaskellExpr(method.expr);
        const resultReg = this._emitHaskellExpr(ast, code, locals, rom, capNames, errors, manifest, method.startLine);

        if (errors.length > 0) {
            return { code: [], errors, manifest: [] };
        }

        if (resultReg !== 0) {
            code.push(this.encode(this.opcodes.IADD, 14, 0, resultReg, 0));
        }
        manifest.push({ src: method.startLine, addr: code.length, desc: 'RETURN (implicit)' });
        code.push(this.encode(this.opcodes.RETURN, 14, 0, 0, 0));

        return { code, errors, manifest };
    }

    _emitHaskellExpr(node, code, locals, rom, capNames, errors, manifest, lineNum) {
        if (!node) return 0;

        switch (node.type) {
            case 'literal': {
                const dr = this._allocTemp(locals);
                const val = node.value & 0x7FFF;
                manifest.push({ src: lineNum, addr: code.length, desc: `literal ${node.value}` });
                code.push(this.encode(this.opcodes.IADD, 14, dr, 0, val));
                return dr;
            }

            case 'var': {
                if (locals[node.name] !== undefined) {
                    return locals[node.name];
                }
                const capIdx = rom[node.name.toUpperCase()];
                if (capIdx !== undefined) {
                    const dr = this._allocTemp(locals);
                    manifest.push({ src: lineNum, addr: code.length, desc: `LOAD ${node.name} from c-list[${capIdx}]` });
                    code.push(this.encode(this.opcodes.LOAD, 14, 0, 6, capIdx));
                    code.push(this.encode(this.opcodes.IADD, 14, dr, 0, 0));
                    return dr;
                }
                errors.push({ line: lineNum, message: `Undefined variable: ${node.name}` });
                return 0;
            }

            case 'lambda': {
                const lambdaLocals = { ...locals };
                for (let pi = 0; pi < node.params.length; pi++) {
                    if (pi <= this.DR_ARGS_END) {
                        lambdaLocals[node.params[pi]] = pi;
                    } else {
                        lambdaLocals[node.params[pi]] = this._allocLocal(node.params[pi], lambdaLocals, errors, lineNum);
                    }
                }

                const bodyStart = code.length;
                manifest.push({ src: lineNum, addr: bodyStart, desc: `lambda \\${node.params.join(' ')} -> ...` });

                const resultReg = this._emitHaskellExpr(node.body, code, lambdaLocals, rom, capNames, errors, manifest, lineNum);

                if (resultReg !== 0) {
                    code.push(this.encode(this.opcodes.IADD, 14, 0, resultReg, 0));
                }

                manifest.push({ src: lineNum, addr: code.length, desc: 'RETURN (lambda end)' });
                code.push(this.encode(this.opcodes.RETURN, 14, 0, 0, 0));

                const dr = this._allocTemp(locals);
                manifest.push({ src: lineNum, addr: code.length, desc: `LAMBDA ref -> addr ${bodyStart}` });
                code.push(this.encode(this.opcodes.LAMBDA, 14, dr, 0, bodyStart & 0x7FFF));
                return dr;
            }

            case 'app': {
                if (node.func.type === 'var' && node.func.name.includes('.')) {
                    const parts = node.func.name.split('.');
                    const absName = parts[0].toUpperCase();
                    const methodName = parts[1];
                    const capIdx = rom[absName];

                    if (capIdx !== undefined) {
                        const argReg = this._emitHaskellExpr(node.arg, code, locals, rom, capNames, errors, manifest, lineNum);
                        if (argReg !== 0) {
                            code.push(this.encode(this.opcodes.IADD, 14, 0, argReg, 0));
                        }
                        manifest.push({ src: lineNum, addr: code.length, desc: `LOAD CR0, [CR6 + ${capIdx}] (${parts[0]})` });
                        code.push(this.encode(this.opcodes.LOAD, 14, 0, 6, capIdx));
                        manifest.push({ src: lineNum, addr: code.length, desc: `CALL CR0 -> ${node.func.name}` });
                        code.push(this.encode(this.opcodes.CALL, 14, 0, 0, 0));
                        const dr = this._allocTemp(locals);
                        code.push(this.encode(this.opcodes.IADD, 14, dr, 0, 0));
                        return dr;
                    }
                }

                if (node.func.type === 'var' && node.func.name === 'succ') {
                    const argReg = this._emitHaskellExpr(node.arg, code, locals, rom, capNames, errors, manifest, lineNum);
                    const dr = this._allocTemp(locals);
                    manifest.push({ src: lineNum, addr: code.length, desc: 'succ (Church successor)' });
                    code.push(this.encode(this.opcodes.IADD, 14, dr, argReg, 1));
                    return dr;
                }

                if (node.func.type === 'var' && node.func.name === 'pred') {
                    const argReg = this._emitHaskellExpr(node.arg, code, locals, rom, capNames, errors, manifest, lineNum);
                    const dr = this._allocTemp(locals);
                    manifest.push({ src: lineNum, addr: code.length, desc: 'pred (Church predecessor)' });
                    code.push(this.encode(this.opcodes.ISUB, 14, dr, argReg, 1));
                    return dr;
                }

                if (node.func.type === 'var' && node.func.name === 'isZero') {
                    const argReg = this._emitHaskellExpr(node.arg, code, locals, rom, capNames, errors, manifest, lineNum);
                    const dr = this._allocTemp(locals);
                    manifest.push({ src: lineNum, addr: code.length, desc: 'isZero check' });
                    code.push(this.encode(this.opcodes.MCMP, 14, argReg, 0, 0));
                    code.push(this.encode(this.opcodes.IADD, this.conditions.EQ, dr, 0, 1));
                    code.push(this.encode(this.opcodes.IADD, this.conditions.NE, dr, 0, 0));
                    return dr;
                }

                if (node.func.type === 'var' && node.func.name === 'fst') {
                    const argReg = this._emitHaskellExpr(node.arg, code, locals, rom, capNames, errors, manifest, lineNum);
                    const dr = this._allocTemp(locals);
                    manifest.push({ src: lineNum, addr: code.length, desc: 'fst (pair first)' });
                    code.push(this.encode(this.opcodes.SHR, 14, dr, argReg, 16));
                    return dr;
                }

                if (node.func.type === 'var' && node.func.name === 'snd') {
                    const argReg = this._emitHaskellExpr(node.arg, code, locals, rom, capNames, errors, manifest, lineNum);
                    const dr = this._allocTemp(locals);
                    manifest.push({ src: lineNum, addr: code.length, desc: 'snd (pair second)' });
                    code.push(this.encode(this.opcodes.BFEXT, 14, dr, argReg, (0 << 5) | 16));
                    return dr;
                }

                const funcReg = this._emitHaskellExpr(node.func, code, locals, rom, capNames, errors, manifest, lineNum);
                const argReg = this._emitHaskellExpr(node.arg, code, locals, rom, capNames, errors, manifest, lineNum);

                if (argReg !== 0) {
                    code.push(this.encode(this.opcodes.IADD, 14, 0, argReg, 0));
                }

                manifest.push({ src: lineNum, addr: code.length, desc: `CALL lambda` });
                code.push(this.encode(this.opcodes.CALL, 14, 0, 0, 0));
                const resultDR = this._allocTemp(locals);
                code.push(this.encode(this.opcodes.IADD, 14, resultDR, 0, 0));
                return resultDR;
            }

            case 'binop': {
                const leftReg = this._emitHaskellExpr(node.left, code, locals, rom, capNames, errors, manifest, lineNum);
                const rightReg = this._emitHaskellExpr(node.right, code, locals, rom, capNames, errors, manifest, lineNum);
                const dr = this._allocTemp(locals);

                switch (node.op) {
                    case '+':
                        manifest.push({ src: lineNum, addr: code.length, desc: 'add' });
                        code.push(this.encode(this.opcodes.IADD, 14, dr, leftReg, 0));
                        code.push(this.encode(this.opcodes.IADD, 14, dr, dr, 0));
                        if (rightReg !== dr) {
                            code[code.length - 1] = this.encode(this.opcodes.IADD, 14, dr, leftReg, 0);
                            code.push(this.encode(this.opcodes.IADD, 14, dr, dr, 0));
                        }
                        code.length -= 2;
                        code.push(this.encode(this.opcodes.IADD, 14, dr, leftReg, 0));
                        if (leftReg !== rightReg) {
                            const t2 = this._allocTemp(locals);
                            code[code.length - 1] = this.encode(this.opcodes.IADD, 14, dr, leftReg, 0);
                        }
                        code.length--;
                        if (node.right.type === 'literal' && node.right.value <= 0x7FFF) {
                            code.push(this.encode(this.opcodes.IADD, 14, dr, leftReg, node.right.value & 0x7FFF));
                        } else {
                            code.push(this.encode(this.opcodes.IADD, 14, dr, leftReg, 0));
                        }
                        break;
                    case '-':
                        manifest.push({ src: lineNum, addr: code.length, desc: 'subtract' });
                        if (node.right.type === 'literal' && node.right.value <= 0x7FFF) {
                            code.push(this.encode(this.opcodes.ISUB, 14, dr, leftReg, node.right.value & 0x7FFF));
                        } else {
                            code.push(this.encode(this.opcodes.ISUB, 14, dr, leftReg, 0));
                        }
                        break;
                    case '*':
                        manifest.push({ src: lineNum, addr: code.length, desc: 'multiply (iterative add)' });
                        code.push(this.encode(this.opcodes.IADD, 14, dr, 0, 0));
                        const loopAddr = code.length;
                        code.push(this.encode(this.opcodes.MCMP, 14, rightReg, 0, 0));
                        const exitAddr = code.length;
                        code.push(this.encode(this.opcodes.BRANCH, this.conditions.EQ, 0, 0, 0));
                        code.push(this.encode(this.opcodes.IADD, 14, dr, dr, 0));
                        code.push(this.encode(this.opcodes.ISUB, 14, rightReg, rightReg, 1));
                        code.push(this.encode(this.opcodes.BRANCH, 14, 0, 0, loopAddr & 0x7FFF));
                        const exitTarget = code.length;
                        code[exitAddr] = (code[exitAddr] & ~0x7FFF) | (exitTarget & 0x7FFF);
                        code[exitAddr] = code[exitAddr] >>> 0;
                        break;
                    case '/': {
                        manifest.push({ src: lineNum, addr: code.length, desc: 'divide (repeated subtraction)' });
                        const remDR = this._allocTemp(locals);
                        code.push(this.encode(this.opcodes.IADD, 14, dr, 0, 0));
                        code.push(this.encode(this.opcodes.IADD, 14, remDR, leftReg, 0));
                        const divLoop = code.length;
                        code.push(this.encode(this.opcodes.MCMP, 14, remDR, rightReg, 0));
                        const divExit = code.length;
                        code.push(this.encode(this.opcodes.BRANCH, this.conditions.LT, 0, 0, 0));
                        code.push(this.encode(this.opcodes.ISUB, 14, remDR, remDR, rightReg));
                        code.push(this.encode(this.opcodes.IADD, 14, dr, dr, 1));
                        code.push(this.encode(this.opcodes.BRANCH, 14, 0, 0, divLoop & 0x7FFF));
                        const divExitTarget = code.length;
                        code[divExit] = (code[divExit] & ~0x7FFF) | (divExitTarget & 0x7FFF);
                        code[divExit] = code[divExit] >>> 0;
                        break;
                    }
                    case '==':
                        manifest.push({ src: lineNum, addr: code.length, desc: 'equals' });
                        code.push(this.encode(this.opcodes.MCMP, 14, leftReg, rightReg, 0));
                        code.push(this.encode(this.opcodes.IADD, this.conditions.EQ, dr, 0, 1));
                        code.push(this.encode(this.opcodes.IADD, this.conditions.NE, dr, 0, 0));
                        break;
                    case '/=':
                        manifest.push({ src: lineNum, addr: code.length, desc: 'not equals' });
                        code.push(this.encode(this.opcodes.MCMP, 14, leftReg, rightReg, 0));
                        code.push(this.encode(this.opcodes.IADD, this.conditions.NE, dr, 0, 1));
                        code.push(this.encode(this.opcodes.IADD, this.conditions.EQ, dr, 0, 0));
                        break;
                    case '<':
                        manifest.push({ src: lineNum, addr: code.length, desc: 'less than' });
                        code.push(this.encode(this.opcodes.MCMP, 14, leftReg, rightReg, 0));
                        code.push(this.encode(this.opcodes.IADD, this.conditions.LT, dr, 0, 1));
                        code.push(this.encode(this.opcodes.IADD, this.conditions.GE, dr, 0, 0));
                        break;
                    case '>':
                        manifest.push({ src: lineNum, addr: code.length, desc: 'greater than' });
                        code.push(this.encode(this.opcodes.MCMP, 14, leftReg, rightReg, 0));
                        code.push(this.encode(this.opcodes.IADD, this.conditions.GT, dr, 0, 1));
                        code.push(this.encode(this.opcodes.IADD, this.conditions.LE, dr, 0, 0));
                        break;
                    case '<=':
                        manifest.push({ src: lineNum, addr: code.length, desc: 'less or equal' });
                        code.push(this.encode(this.opcodes.MCMP, 14, leftReg, rightReg, 0));
                        code.push(this.encode(this.opcodes.IADD, this.conditions.LE, dr, 0, 1));
                        code.push(this.encode(this.opcodes.IADD, this.conditions.GT, dr, 0, 0));
                        break;
                    case '>=':
                        manifest.push({ src: lineNum, addr: code.length, desc: 'greater or equal' });
                        code.push(this.encode(this.opcodes.MCMP, 14, leftReg, rightReg, 0));
                        code.push(this.encode(this.opcodes.IADD, this.conditions.GE, dr, 0, 1));
                        code.push(this.encode(this.opcodes.IADD, this.conditions.LT, dr, 0, 0));
                        break;
                    default:
                        errors.push({ line: lineNum, message: `Unknown operator: ${node.op}` });
                        return 0;
                }
                return dr;
            }

            case 'let': {
                const letLocals = { ...locals };
                for (const binding of node.bindings) {
                    const valReg = this._emitHaskellExpr(binding.value, code, letLocals, rom, capNames, errors, manifest, lineNum);
                    const dr = this._allocLocal(binding.name, letLocals, errors, lineNum);
                    if (valReg !== dr) {
                        code.push(this.encode(this.opcodes.IADD, 14, dr, valReg, 0));
                    }
                    manifest.push({ src: lineNum, addr: code.length - 1, desc: `let ${binding.name}` });
                }
                return this._emitHaskellExpr(node.body, code, letLocals, rom, capNames, errors, manifest, lineNum);
            }

            case 'case': {
                const scrutReg = this._emitHaskellExpr(node.scrutinee, code, locals, rom, capNames, errors, manifest, lineNum);
                const resultDR = this._allocTemp(locals);
                const endLabels = [];

                for (let bi = 0; bi < node.branches.length; bi++) {
                    const branch = node.branches[bi];

                    if (branch.pattern.type === 'litPat') {
                        const litDR = this._allocTemp(locals);
                        code.push(this.encode(this.opcodes.IADD, 14, litDR, 0, branch.pattern.value & 0x7FFF));
                        code.push(this.encode(this.opcodes.MCMP, 14, scrutReg, litDR, 0));
                        const skipAddr = code.length;
                        code.push(this.encode(this.opcodes.BRANCH, this.conditions.NE, 0, 0, 0));
                        manifest.push({ src: lineNum, addr: skipAddr, desc: `case ${branch.pattern.value} ->` });

                        const branchLocals = { ...locals };
                        const bodyReg = this._emitHaskellExpr(branch.body, code, branchLocals, rom, capNames, errors, manifest, lineNum);
                        code.push(this.encode(this.opcodes.IADD, 14, resultDR, bodyReg, 0));
                        const jumpEnd = code.length;
                        code.push(this.encode(this.opcodes.BRANCH, 14, 0, 0, 0));
                        endLabels.push(jumpEnd);

                        code[skipAddr] = (code[skipAddr] & ~0x7FFF) | (code.length & 0x7FFF);
                        code[skipAddr] = code[skipAddr] >>> 0;

                    } else if (branch.pattern.type === 'varPat') {
                        const branchLocals = { ...locals };
                        const dr = this._allocLocal(branch.pattern.name, branchLocals, errors, lineNum);
                        if (dr !== scrutReg) {
                            code.push(this.encode(this.opcodes.IADD, 14, dr, scrutReg, 0));
                        }
                        manifest.push({ src: lineNum, addr: code.length, desc: `case ${branch.pattern.name} ->` });
                        const bodyReg = this._emitHaskellExpr(branch.body, code, branchLocals, rom, capNames, errors, manifest, lineNum);
                        code.push(this.encode(this.opcodes.IADD, 14, resultDR, bodyReg, 0));
                        const jumpEnd = code.length;
                        code.push(this.encode(this.opcodes.BRANCH, 14, 0, 0, 0));
                        endLabels.push(jumpEnd);

                    } else {
                        manifest.push({ src: lineNum, addr: code.length, desc: 'case _ ->' });
                        const branchLocals = { ...locals };
                        const bodyReg = this._emitHaskellExpr(branch.body, code, branchLocals, rom, capNames, errors, manifest, lineNum);
                        code.push(this.encode(this.opcodes.IADD, 14, resultDR, bodyReg, 0));
                        const jumpEnd = code.length;
                        code.push(this.encode(this.opcodes.BRANCH, 14, 0, 0, 0));
                        endLabels.push(jumpEnd);
                    }
                }

                const endAddr = code.length;
                for (const addr of endLabels) {
                    code[addr] = (code[addr] & ~0x7FFF) | (endAddr & 0x7FFF);
                    code[addr] = code[addr] >>> 0;
                }

                return resultDR;
            }

            case 'ifExpr': {
                const condReg = this._emitHaskellExpr(node.cond, code, locals, rom, capNames, errors, manifest, lineNum);
                code.push(this.encode(this.opcodes.MCMP, 14, condReg, 0, 0));
                const skipThen = code.length;
                code.push(this.encode(this.opcodes.BRANCH, this.conditions.EQ, 0, 0, 0));
                manifest.push({ src: lineNum, addr: skipThen, desc: 'if-then-else' });

                const resultDR = this._allocTemp(locals);
                const thenReg = this._emitHaskellExpr(node.thenBranch, code, locals, rom, capNames, errors, manifest, lineNum);
                code.push(this.encode(this.opcodes.IADD, 14, resultDR, thenReg, 0));
                const skipElse = code.length;
                code.push(this.encode(this.opcodes.BRANCH, 14, 0, 0, 0));

                code[skipThen] = (code[skipThen] & ~0x7FFF) | (code.length & 0x7FFF);
                code[skipThen] = code[skipThen] >>> 0;

                const elseReg = this._emitHaskellExpr(node.elseBranch, code, locals, rom, capNames, errors, manifest, lineNum);
                code.push(this.encode(this.opcodes.IADD, 14, resultDR, elseReg, 0));

                code[skipElse] = (code[skipElse] & ~0x7FFF) | (code.length & 0x7FFF);
                code[skipElse] = code[skipElse] >>> 0;

                return resultDR;
            }

            case 'pair': {
                const fstReg = this._emitHaskellExpr(node.fst, code, locals, rom, capNames, errors, manifest, lineNum);
                const sndReg = this._emitHaskellExpr(node.snd, code, locals, rom, capNames, errors, manifest, lineNum);
                const dr = this._allocTemp(locals);
                manifest.push({ src: lineNum, addr: code.length, desc: 'pair (fst, snd)' });
                code.push(this.encode(this.opcodes.SHL, 14, dr, fstReg, 16));
                code.push(this.encode(this.opcodes.BFINS, 14, dr, sndReg, (0 << 5) | 16));
                return dr;
            }

            case 'pure': {
                return this._emitHaskellExpr(node.value, code, locals, rom, capNames, errors, manifest, lineNum);
            }

            default:
                errors.push({ line: lineNum, message: `Unknown Haskell AST node type: ${node.type}` });
                return 0;
        }
    }

    _detectSymbolic(source) {
        if (this._detectEnglish(source)) return false;
        // Guard: plain JS array/object constants and class files are not symbolic Ada
        if (/^\s*const\s+\w+\s*=\s*[\[{]/m.test(source)) return false;
        if (/^\s*(?:export\s+)?(?:default\s+)?class\s+\w+/m.test(source)) return false;
        const lines = source.split('\n');
        let adaVars = 0;
        let arrowAssign = 0;
        let opKeywords = 0;
        for (const line of lines) {
            let t = line.trim();
            const semiPos = t.indexOf(';');
            if (semiPos >= 0) t = t.substring(0, semiPos).trim();
            if (!t || t.startsWith('--') || t.startsWith('//')) continue;
            if (t.match(/^abstraction\s+\w+\s*\{/)) continue;
            if (t.match(/^capabilities\s*\{/)) continue;
            if (t === '}') continue;
            if (t.match(/\bV\d+\b/) && (t.includes('=') || t.includes('→') || t.includes('->'))) adaVars++;
            if (t.includes('→') || (t.match(/\S\s*->\s*V\d+/) && !t.includes('\\'))) arrowAssign++;
            if (t.match(/^(multiply|divide|add|subtract|operation|repeat)\b/i)) opKeywords++;
            if (t.match(/^step\s+\d+/i)) opKeywords++;
        }
        return (adaVars >= 2) || (arrowAssign >= 1) || (opKeywords >= 2);
    }

    _sourceNeedsSlideRule(parsed) {
        for (const method of parsed.methods) {
            for (const stmt of method.body) {
                const text = (stmt.text || '').replace(/×/g, '*').replace(/÷/g, '/');
                if (/[*\/]/.test(text) || /\b(multiply|divide|bernoulli)\s*\(/i.test(text) || /\bSlideRule\.\w+\s*\(/i.test(text)) {
                    return true;
                }
            }
        }
        return false;
    }

    compileSymbolic(source, capabilities) {
        const errors = [];
        const parsed = this._parseSymbolicAbstraction(source, errors);
        if (errors.length > 0) {
            return { methods: [], errors, manifest: [], abstractionName: parsed.name || '', capabilities: parsed.capabilities || [], language: 'symbolic' };
        }

        const needsSlideRule = this._sourceNeedsSlideRule(parsed);
        if (needsSlideRule && !parsed.capabilities.map(c => c.toUpperCase()).includes('SLIDERULE')) {
            parsed.capabilities.push('SlideRule');
        }

        const rom = this._buildROM(parsed.capabilities, capabilities || []);
        const methods = [];
        const manifest = [];

        for (const method of parsed.methods) {
            const result = this._compileSymbolicMethod(method, rom, parsed.capabilities, errors);
            if (result.errors.length > 0) {
                errors.push(...result.errors);
            } else {
                methods.push({ name: method.name, code: result.code });
                manifest.push({ name: method.name, mapping: result.manifest });
            }
        }

        return { methods, errors, manifest, abstractionName: parsed.name, capabilities: parsed.capabilities || [], language: 'symbolic' };
    }

    _parseSymbolicAbstraction(source, errors) {
        const result = { name: '', capabilities: [], methods: [] };
        const lines = source.split('\n');
        let i = 0;
        let hasAbstraction = false;

        while (i < lines.length) {
            const line = lines[i].trim();
            if (!line || line.startsWith('--') || line.startsWith('//') || line.startsWith(';')) { i++; continue; }

            const absMatch = line.match(/^abstraction\s+(\w+)\s*\{/);
            if (absMatch) {
                result.name = absMatch[1];
                hasAbstraction = true;
                i++;
                i = this._parseSymbolicBody(lines, i, result, errors);
                break;
            }
            i++;
        }

        if (!hasAbstraction) {
            result.name = 'Symbolic';
            const stmts = [];
            for (let j = 0; j < lines.length; j++) {
                const line = lines[j].trim();
                if (!line || line.startsWith('--') || line.startsWith('//') || line.startsWith(';')) continue;
                stmts.push({ line: j + 1, text: line });
            }
            if (stmts.length > 0) {
                result.methods.push({ name: 'compute', params: [], body: stmts });
            }
        }

        return result;
    }

    _parseSymbolicBody(lines, i, result, errors) {
        while (i < lines.length) {
            const line = lines[i].trim();
            if (!line || line.startsWith('--') || line.startsWith('//') || line.startsWith(';')) { i++; continue; }
            if (line === '}') return i + 1;

            const capMatch = line.match(/^capabilities\s*\{/);
            if (capMatch) {
                const inlineMatch = line.match(/^capabilities\s*\{\s*(.*?)\s*\}$/);
                if (inlineMatch) {
                    if (inlineMatch[1]) {
                        result.capabilities.push(...inlineMatch[1].replace(/,/g, ' ').split(/\s+/).filter(Boolean));
                    }
                    i++;
                } else {
                    i++;
                    while (i < lines.length) {
                        const capLine = lines[i].trim();
                        if (capLine === '}') { i++; break; }
                        if (capLine && !capLine.startsWith('--')) {
                            result.capabilities.push(...capLine.replace(/,/g, ' ').split(/\s+/).filter(Boolean));
                        }
                        i++;
                    }
                }
                continue;
            }

            const methodMatch = line.match(/^method\s+(\w+)\s*(?:\(([^)]*)\))?\s*\{/);
            if (methodMatch) {
                const method = { name: methodMatch[1], params: [], body: [] };
                if (methodMatch[2]) {
                    method.params = methodMatch[2].split(',').map(s => s.trim()).filter(Boolean);
                }
                i++;
                while (i < lines.length) {
                    const bodyLine = lines[i].trim();
                    if (bodyLine === '}') { i++; break; }
                    if (bodyLine && !bodyLine.startsWith('--') && !bodyLine.startsWith('//')) {
                        method.body.push({ line: i + 1, text: bodyLine });
                    } else if (bodyLine.startsWith('--') || bodyLine.startsWith('//')) {
                        method.body.push({ line: i + 1, text: bodyLine, comment: true });
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

    _compileSymbolicMethod(method, rom, capNames, outerErrors) {
        const code = [];
        const errors = [];
        const manifest = [];
        const vars = {};
        let nextLocal = this.DR_LOCALS_START;
        const constants = [];
        const loopStack = [];

        for (const param of method.params) {
            const paramIdx = method.params.indexOf(param);
            if (paramIdx <= this.DR_ARGS_END) {
                vars[param] = paramIdx;
            }
        }

        const allocVar = (name) => {
            if (vars[name] !== undefined) return vars[name];
            const vMatch = name.match(/^V(\d+)$/);
            if (vMatch) {
                const vNum = parseInt(vMatch[1]);
                if (vNum >= 1 && vNum <= 15) {
                    vars[name] = vNum;
                    return vNum;
                }
            }
            if (nextLocal > this.DR_LOCALS_END) {
                nextLocal = this.DR_TEMP_START;
            }
            if (nextLocal > this.DR_TEMP_END) {
                errors.push({ line: 0, message: `Out of registers for variable: ${name}` });
                return this.DR_TEMP_START;
            }
            vars[name] = nextLocal;
            return nextLocal++;
        };

        const getVar = (name) => {
            if (vars[name] !== undefined) return vars[name];
            return allocVar(name);
        };

        const parseExprValue = (expr) => {
            expr = expr.trim();
            if (expr === '0') return { type: 'zero' };
            const num = parseInt(expr);
            if (!isNaN(num) && num > 0) return { type: 'const', value: num };
            const vMatch = expr.match(/^V(\d+)$/);
            if (vMatch) return { type: 'var', name: expr };
            if (expr.match(/^[a-zA-Z_]\w*$/)) return { type: 'var', name: expr };
            return { type: 'expr', text: expr };
        };

        const emitLoadConst = (dr, value) => {
            code.push(this.encode(this.opcodes.IADD, 14, dr, 0, value | 0x4000));
            manifest.push({ line: 0, instr: `IADD DR${dr}, DR0, #${value}`, comment: `load constant ${value}` });
        };

        const slideRuleMethodIndex = { Multiply: 0, Divide: 1, Sqrt: 2, Mod: 3, Bernoulli: 12 };

        const emitExpr = (expr, dstDR, lineNum) => {
            expr = expr.trim();

            expr = expr.replace(/×/g, '*').replace(/÷/g, '/');

            const slideRuleMatch = expr.match(/^SlideRule\.(\w+)\s*\(\s*(.+)\s*\)$/);
            if (slideRuleMatch) {
                const srMethod = slideRuleMatch[1];
                const srArgStr = slideRuleMatch[2];
                const srMethodKey = srMethod.charAt(0).toUpperCase() + srMethod.slice(1);
                if (slideRuleMethodIndex[srMethodKey] === undefined) {
                    errors.push({ line: lineNum, message: `Unknown SlideRule method: ${srMethod}. Available: ${Object.keys(slideRuleMethodIndex).join(', ')}` });
                    return dstDR;
                }
                    const srArgs = srArgStr.split(/\s*,\s*/);
                    const leftArg = parseExprValue(srArgs[0]);
                    const leftDR = loadToReg(leftArg, this.DR_TEMP_START, lineNum);
                    let rightDR = 0;
                    if (srArgs.length > 1) {
                        const rightArg = parseExprValue(srArgs[1]);
                        rightDR = loadToReg(rightArg, this.DR_TEMP_START + 1, lineNum);
                    }
                    emitSlideRuleCall(srMethodKey, leftDR, rightDR, dstDR, lineNum, `SlideRule.${srMethodKey}(${srArgStr})`);
                    return dstDR;
            }

            const funcMatch = expr.match(/^(multiply|divide|add|subtract|succ|pred|negate|abs|bernoulli)\s*\(\s*(.+)\s*\)$/i);
            if (funcMatch) {
                const func = funcMatch[1].toLowerCase();
                const argStr = funcMatch[2];
                if (func === 'bernoulli') {
                    const arg = parseExprValue(argStr);
                    const srcDR = loadToReg(arg, this.DR_TEMP_START, lineNum);
                    emitSlideRuleCall('Bernoulli', srcDR, 0, dstDR, lineNum, `bernoulli(${argStr})`);
                    return dstDR;
                }
                if (func === 'succ') {
                    const arg = parseExprValue(argStr);
                    const srcDR = loadToReg(arg, this.DR_TEMP_START, lineNum);
                    code.push(this.encode(this.opcodes.IADD, 14, dstDR, srcDR, 1));
                    manifest.push({ line: lineNum, instr: `IADD DR${dstDR}, DR${srcDR}, 1`, comment: `succ(${argStr})` });
                    return dstDR;
                }
                if (func === 'pred') {
                    const arg = parseExprValue(argStr);
                    const srcDR = loadToReg(arg, this.DR_TEMP_START, lineNum);
                    code.push(this.encode(this.opcodes.ISUB, 14, dstDR, srcDR, 1));
                    manifest.push({ line: lineNum, instr: `ISUB DR${dstDR}, DR${srcDR}, 1`, comment: `pred(${argStr})` });
                    return dstDR;
                }
                if (func === 'negate') {
                    const arg = parseExprValue(argStr);
                    const srcDR = loadToReg(arg, this.DR_TEMP_START, lineNum);
                    code.push(this.encode(this.opcodes.ISUB, 14, dstDR, 0, srcDR));
                    manifest.push({ line: lineNum, instr: `ISUB DR${dstDR}, DR0, DR${srcDR}`, comment: `negate(${argStr})` });
                    return dstDR;
                }
                const parts = argStr.split(',').map(s => s.trim());
                if (parts.length >= 2) {
                    const leftVal = parseExprValue(parts[0]);
                    const rightVal = parseExprValue(parts[1]);
                    const leftDR = loadToReg(leftVal, this.DR_TEMP_START, lineNum);
                    const rightDR = loadToReg(rightVal, this.DR_TEMP_START + 1, lineNum);
                    if (func === 'add') {
                        code.push(this.encode(this.opcodes.IADD, 14, dstDR, leftDR, rightDR));
                        manifest.push({ line: lineNum, instr: `IADD DR${dstDR}, DR${leftDR}, DR${rightDR}`, comment: `add(${parts[0]}, ${parts[1]})` });
                    } else if (func === 'subtract') {
                        code.push(this.encode(this.opcodes.ISUB, 14, dstDR, leftDR, rightDR));
                        manifest.push({ line: lineNum, instr: `ISUB DR${dstDR}, DR${leftDR}, DR${rightDR}`, comment: `subtract(${parts[0]}, ${parts[1]})` });
                    } else if (func === 'multiply') {
                        emitMultiply(leftDR, rightDR, dstDR, lineNum, `multiply(${parts[0]}, ${parts[1]})`);
                    } else if (func === 'divide') {
                        emitDivide(leftDR, rightDR, dstDR, lineNum, `divide(${parts[0]}, ${parts[1]})`);
                    }
                    return dstDR;
                }
            }

            const binMatch = expr.match(/^(.+?)\s*([+\-*/])\s*([^+\-*/]+)$/);
            if (binMatch) {
                const leftExpr = binMatch[1].trim();
                const op = binMatch[2];
                const rightExpr = binMatch[3].trim();
                const leftVal = parseExprValue(leftExpr);
                const rightVal = parseExprValue(rightExpr);
                const leftDR = loadToReg(leftVal, this.DR_TEMP_START, lineNum);
                const rightDR = loadToReg(rightVal, this.DR_TEMP_START + 1, lineNum);

                switch (op) {
                    case '+':
                        code.push(this.encode(this.opcodes.IADD, 14, dstDR, leftDR, rightDR));
                        manifest.push({ line: lineNum, instr: `IADD DR${dstDR}, DR${leftDR}, DR${rightDR}`, comment: `${leftExpr} + ${rightExpr}` });
                        break;
                    case '-':
                        code.push(this.encode(this.opcodes.ISUB, 14, dstDR, leftDR, rightDR));
                        manifest.push({ line: lineNum, instr: `ISUB DR${dstDR}, DR${leftDR}, DR${rightDR}`, comment: `${leftExpr} - ${rightExpr}` });
                        break;
                    case '*':
                        emitMultiply(leftDR, rightDR, dstDR, lineNum, `${leftExpr} * ${rightExpr}`);
                        break;
                    case '/':
                        emitDivide(leftDR, rightDR, dstDR, lineNum, `${leftExpr} / ${rightExpr}`);
                        break;
                }
                return dstDR;
            }

            const val = parseExprValue(expr);
            const srcDR = loadToReg(val, dstDR, lineNum);
            if (srcDR !== dstDR) {
                code.push(this.encode(this.opcodes.IADD, 14, dstDR, srcDR, 0));
                manifest.push({ line: lineNum, instr: `IADD DR${dstDR}, DR${srcDR}, DR0`, comment: `copy ${expr}` });
            }
            return dstDR;
        };

        const loadToReg = (val, preferDR, lineNum) => {
            if (val.type === 'zero') return 0;
            if (val.type === 'var') {
                return getVar(val.name);
            }
            if (val.type === 'const') {
                emitLoadConst(preferDR, val.value);
                return preferDR;
            }
            if (val.type === 'expr') {
                emitExpr(val.text, preferDR, lineNum);
                return preferDR;
            }
            return 0;
        };

        const findTempReg = (...exclude) => {
            for (let r = 15; r >= 12; r--) {
                if (exclude.includes(r)) continue;
                const inUse = Object.values(vars).includes(r);
                if (!inUse) return r;
            }
            return 14;
        };

        let slideRuleCR0Loaded = false;

        const emitSlideRuleCall = (methodName, leftDR, rightDR, dstDR, lineNum, comment) => {
            const methodIdx = slideRuleMethodIndex[methodName];
            const slideRuleSlot = rom['SLIDERULE'];
            if (!slideRuleCR0Loaded) {
                code.push(this.encode(this.opcodes.LOAD, 14, 0, 6, slideRuleSlot));
                manifest.push({ line: lineNum, instr: `LOAD CR0, CR6, ${slideRuleSlot}`, comment: `load SlideRule capability` });
                slideRuleCR0Loaded = true;
            }
            const packed = 0x4000 | (methodIdx << 8) | (leftDR << 4) | rightDR;
            code.push(this.encode(this.opcodes.CALL, 14, 0, dstDR, packed));
            manifest.push({ line: lineNum, instr: `CALL CR0`, comment: `SlideRule.${methodName}(DR${leftDR}, DR${rightDR}) -> DR${dstDR}` });
        };

        const emitMultiply = (leftDR, rightDR, dstDR, lineNum, comment) => {
            emitSlideRuleCall('Multiply', leftDR, rightDR, dstDR, lineNum, comment);
        };

        const emitDivide = (leftDR, rightDR, dstDR, lineNum, comment) => {
            emitSlideRuleCall('Divide', leftDR, rightDR, dstDR, lineNum, comment);
        };

        for (const stmt of method.body) {
            if (stmt.comment) continue;
            const lineNum = stmt.line;
            let text = stmt.text.trim();

            let commentIdx = text.indexOf('--');
            if (commentIdx > 0) text = text.substring(0, commentIdx).trim();
            commentIdx = text.indexOf('//');
            if (commentIdx > 0) text = text.substring(0, commentIdx).trim();
            commentIdx = text.indexOf(';');
            if (commentIdx > 0) text = text.substring(0, commentIdx).trim();

            text = text.replace(/×/g, '*').replace(/÷/g, '/');

            const arrowMatch = text.match(/^(.+?)\s*(?:→|->)\s*(\w+)$/);
            if (arrowMatch) {
                const expr = arrowMatch[1].trim();
                const target = arrowMatch[2].trim();
                const dstDR = allocVar(target);
                emitExpr(expr, dstDR, lineNum);
                continue;
            }

            const letMatch = text.match(/^let\s+(\w+(?:\s*,\s*\w+)*)\s*=\s*(.+)$/);
            if (letMatch) {
                const targets = letMatch[1].split(',').map(t => t.trim());
                const expr = letMatch[2].trim();
                const firstDR = allocVar(targets[0]);
                emitExpr(expr, firstDR, lineNum);
                for (let ti = 1; ti < targets.length; ti++) {
                    const extraDR = allocVar(targets[ti]);
                    code.push(this.encode(this.opcodes.IADD, 14, extraDR, firstDR, 0));
                    manifest.push({ line: lineNum, instr: `IADD DR${extraDR}, DR${firstDR}, DR0`, comment: `copy to ${targets[ti]}` });
                }
                continue;
            }

            const assignMatch = text.match(/^(\w+)\s*=\s*(.+)$/);
            if (assignMatch) {
                const varName = assignMatch[1].trim();
                const expr = assignMatch[2].trim();
                const dstDR = allocVar(varName);
                emitExpr(expr, dstDR, lineNum);
                continue;
            }

            const returnMatch = text.match(/^return\s+(.+)$/i);
            if (returnMatch) {
                const expr = returnMatch[1].trim();
                emitExpr(expr, 0, lineNum);
                code.push(this.encode(this.opcodes.RETURN, 14, 0, 0, 0));
                manifest.push({ line: lineNum, instr: 'RETURN', comment: `return ${expr}` });
                continue;
            }

            const repeatMatch = text.match(/^repeat\s+(.+?)\s+as\s+(\w+)$/i);
            if (repeatMatch) {
                const countExpr = repeatMatch[1].trim();
                const counterName = repeatMatch[2].trim();
                const counterDR = allocVar(counterName);
                emitExpr(countExpr, counterDR, lineNum);
                manifest.push({ line: lineNum, instr: `-- repeat`, comment: `repeat ${countExpr} as ${counterName}` });
                loopStack.push({ loopStart: code.length, counterDR, counterName, lineNum });
                continue;
            }

            if (text.match(/^end$/i)) {
                if (loopStack.length === 0) {
                    errors.push({ line: lineNum, message: `'end' without matching 'repeat'` });
                    continue;
                }
                const loop = loopStack.pop();
                code.push(this.encode(this.opcodes.ISUB, 14, loop.counterDR, loop.counterDR, 0x4001));
                manifest.push({ line: lineNum, instr: `ISUB DR${loop.counterDR}, DR${loop.counterDR}, #1`, comment: `decrement ${loop.counterName}` });
                code.push(this.encode(this.opcodes.MCMP, 14, loop.counterDR, 0, 0));
                manifest.push({ line: lineNum, instr: `MCMP DR${loop.counterDR}, DR0`, comment: `compare ${loop.counterName} with 0` });
                const branchIdx = code.length;
                const soff = loop.loopStart - branchIdx;
                code.push(this.encode(this.opcodes.BRANCH, this.conditions.GT, 0, 0, soff & 0x7FFF));
                manifest.push({ line: lineNum, instr: `BRANCH GT, ${soff}`, comment: `loop back if ${loop.counterName} > 0` });
                continue;
            }

            if (text.match(/^halt$/i) || text.match(/^stop$/i)) {
                code.push(0);
                manifest.push({ line: lineNum, instr: 'HALT', comment: 'halt (zero word)' });
                continue;
            }

            errors.push({ line: lineNum, message: `Cannot parse symbolic statement: ${text}` });
        }

        if (loopStack.length > 0) {
            for (const unclosed of loopStack) {
                errors.push({ line: unclosed.lineNum, message: `'repeat' without matching 'end'` });
            }
        }

        if (code.length === 0 || (code[code.length - 1] & (0x1F << 27)) !== (this.opcodes.RETURN << 27)) {
            const lastWord = code.length > 0 ? code[code.length - 1] : -1;
            const lastOp = lastWord >>> 27;
            if (lastOp !== this.opcodes.BRANCH && lastWord !== 0) {
                code.push(this.encode(this.opcodes.RETURN, 14, 0, 0, 0));
                manifest.push({ line: 0, instr: 'RETURN', comment: 'implicit return' });
            }
        }

        return { code, errors, manifest };
    }

    _detectEnglish(source) {
        const lines = source.split('\n');
        let englishScore = 0;
        let hasBlockMethod = false;
        let hasEnglishBody = false;
        for (const line of lines) {
            const t = line.trim().toLowerCase();
            if (!t || t.startsWith('//') || t.startsWith('--')) continue;
            if (t.match(/^english\s+abstraction\s+/)) return true;
            if (t.match(/^(create|define|make)\s+(an?\s+)?abstraction\s+(called|named)\s+/)) englishScore += 3;
            if (t.match(/^(add|define|create)\s+(an?\s+)?method\s+(called|named)\s+/)) englishScore += 2;
            if (t.match(/^(set|store|put|assign)\s+/)) englishScore++;
            if (t.match(/^(return|give back|send back)\s+(the\s+)?/)) englishScore++;
            if (t.match(/^(if|when)\s+.+\s+(is|equals|is equal to|is greater than|is less than|is not)\s+/)) englishScore++;
            if (t.match(/^(it needs|it uses|it requires|using)\s+/)) englishScore++;
            if (t.match(/\b(plus|minus|times|divided by|multiplied by|added to|subtracted from)\b/)) englishScore++;
            if (t.match(/^(read|write|load|save)\s+(from|to|the value)\s+/)) englishScore++;
            if (t.match(/^(call|run|execute|invoke)\s+/)) englishScore++;
            if (t.match(/^(that takes|which takes|with parameters?|with inputs?)\s+/)) englishScore++;
            if (t.match(/^\w+\s*\([^)]*\)\s*:\s*$/)) hasBlockMethod = true;  // colon required — bare JS signatures don't qualify
            if (t.match(/^(add|multiply|subtract|divide)\s+\w+\s+(to|by|from)\s+/)) hasEnglishBody = true;
            if (t.match(/\band\s+return\s+(the\s+)?/)) hasEnglishBody = true;
        }
        if (hasBlockMethod && hasEnglishBody) return true;
        return englishScore >= 3;
    }

    compileEnglish(source, capabilities) {
        const errors = [];
        const parsed = this._parseEnglishAbstraction(source, errors);
        if (errors.length > 0) {
            return { methods: [], errors, manifest: [], abstractionName: parsed.name || '', capabilities: parsed.capabilities || [], language: 'english' };
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

        return { methods, errors, manifest, abstractionName: parsed.name, capabilities: parsed.capabilities || [], language: 'english' };
    }

    _parseEnglishAbstraction(source, errors) {
        const result = { name: '', capabilities: [], methods: [] };
        const lines = source.split('\n');
        let currentMethod = null;

        // Guard: reject plain JS class/module files immediately with a clear message
        const isJsClassFile = /^\s*class\s+\w+/m.test(source) ||
                              /^\s*(?:export\s+)?(?:default\s+)?class\s+/m.test(source) ||
                              /registry\.(bind|register)\s*\(/.test(source);
        if (isJsClassFile) {
            errors.push({ line: 0, message: 'Source looks like a JavaScript class file, not CLOOMC++ English.' });
            errors.push({ line: 0, message: 'English mode expects natural language, e.g.:' });
            errors.push({ line: 0, message: '  Create an abstraction called MyDevice' });
            errors.push({ line: 0, message: '  Add a method called Send that takes data' });
            errors.push({ line: 0, message: '    Write data to the UART register' });
            return result;
        }

        const firstLine = lines[0] ? lines[0].trim() : '';
        const blockMatch = firstLine.match(/^(?:ENGLISH\s+)?abstraction\s+(\w+)\s*\{?\s*$/i);
        if (blockMatch) {
            return this._parseEnglishBlock(source, errors);
        }

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const t = raw.trim();
            if (!t || t.startsWith('//') || t.startsWith('--')) continue;
            const lo = t.toLowerCase();

            const absMatch = lo.match(/^(?:create|define|make)\s+(?:an?\s+)?abstraction\s+(?:called|named)\s+(\w+)/);
            if (absMatch) {
                result.name = t.match(/(?:called|named)\s+(\w+)/i)[1];
                continue;
            }

            const capMatch = lo.match(/^(?:it needs|it uses|it requires|using)\s+(.+)/);
            if (capMatch) {
                const caps = capMatch[1].replace(/\band\b/g, ',').replace(/\./g, '').split(',').map(s => s.trim()).filter(Boolean);
                result.capabilities.push(...caps);
                continue;
            }

            const methodMatch = lo.match(/^(?:add|define|create)\s+(?:an?\s+)?method\s+(?:called|named)\s+(\w+)/);
            if (methodMatch) {
                if (currentMethod) result.methods.push(currentMethod);
                const name = t.match(/(?:called|named)\s+(\w+)/i)[1];
                currentMethod = { name: name, params: [], body: [], startLine: i };

                const paramMatch = lo.match(/(?:that takes|which takes|with parameters?|with inputs?)\s+(.+)/);
                if (paramMatch) {
                    const params = paramMatch[1].replace(/\band\b/g, ',').replace(/\./g, '').split(',').map(s => s.trim()).filter(Boolean);
                    currentMethod.params = params;
                }
                continue;
            }

            if (!currentMethod) continue;

            const stmt = this._translateEnglishStatement(t, i);
            if (stmt) {
                currentMethod.body.push({ text: stmt, lineNum: i });
            } else {
                errors.push({ line: i + 1, message: `Cannot understand: "${t}"` });
            }
        }

        if (currentMethod) result.methods.push(currentMethod);

        if (!result.name) {
            if (result.methods.length > 0) {
                result.name = result.methods[0].name || 'English';
            } else {
                errors.push({ line: 0, message: 'No abstraction name found. Try: "Create an abstraction called MyName"' });
            }
        }

        if (result.methods.length === 0) {
            errors.push({ line: 0, message: 'No methods found. Try: "Add a method called DoSomething"' });
        }

        return result;
    }

    _parseEnglishBlock(source, errors) {
        const result = { name: '', capabilities: [], methods: [] };
        const lines = source.split('\n');
        let currentMethod = null;
        let inCapabilities = false;

        const mergedLines = [];
        for (let i = 0; i < lines.length; i++) {
            const t = lines[i].trim();
            const lo = t.toLowerCase();
            if (mergedLines.length > 0 && lo.match(/^and\s+/)) {
                mergedLines[mergedLines.length - 1].text += ' ' + t;
            } else {
                mergedLines.push({ text: t, lineNum: i });
            }
        }

        for (const entry of mergedLines) {
            const t = entry.text;
            const i = entry.lineNum;
            if (!t || t === '{' || t === '}' || t.startsWith('//') || t.startsWith('--')) {
                if (t === '}' && inCapabilities) inCapabilities = false;
                continue;
            }
            const lo = t.toLowerCase();

            const absMatch = lo.match(/^(?:english\s+)?abstraction\s+(\w+)\s*\{?\s*$/);
            if (absMatch) {
                result.name = t.match(/abstraction\s+(\w+)/i)[1];
                continue;
            }

            const capBlockMatch = lo.match(/^capabilities\s*\{\s*(.*?)\s*\}?\s*$/);
            if (capBlockMatch) {
                const inner = capBlockMatch[1];
                if (inner) {
                    const caps = inner.replace(/[{}]/g, '').replace(/\band\b/g, ',').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
                    result.capabilities.push(...caps);
                }
                if (!t.includes('}')) inCapabilities = true;
                continue;
            }

            if (inCapabilities) {
                const caps = t.replace(/[{}]/g, '').replace(/\band\b/g, ',').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
                result.capabilities.push(...caps);
                if (t.includes('}')) inCapabilities = false;
                continue;
            }

            const methodMatch = t.match(/^(\w+)\s*\(([^)]*)\)\s*:?\s*$/);
            if (methodMatch) {
                if (currentMethod) result.methods.push(currentMethod);
                const name = methodMatch[1];
                const params = methodMatch[2].split(',').map(s => s.trim()).filter(Boolean);
                currentMethod = { name, params, body: [], startLine: i };
                continue;
            }

            if (!currentMethod) continue;

            const stmts = this._translateEnglishBlockStatement(t, i);
            if (stmts) {
                for (const s of stmts) {
                    currentMethod.body.push({ text: s, lineNum: i });
                }
            }
        }

        if (currentMethod) result.methods.push(currentMethod);

        if (!result.name) {
            errors.push({ line: 0, message: 'No abstraction name found. Use: ENGLISH abstraction MyName {' });
        }
        if (result.methods.length === 0) {
            errors.push({ line: 0, message: 'No methods found. Use: MethodName(params):' });
        }

        return result;
    }

    _translateEnglishBlockStatement(text, lineNum) {
        const lo = text.toLowerCase().replace(/\.$/, '').trim();

        const returnMatch = lo.match(/^(?:return|give back|send back)\s+(?:the\s+)?(.+)/);
        if (returnMatch) {
            const val = this._translateEnglishExpr(returnMatch[1]);
            return [`return(${val})`];
        }

        const addReturnMatch = lo.match(/^add\s+(.+?)\s+(?:to|and)\s+(.+?)\s+and\s+return\s+(?:the\s+)?(.+)/);
        if (addReturnMatch) {
            const a = this._translateEnglishExpr(addReturnMatch[1]);
            const b = this._translateEnglishExpr(addReturnMatch[2]);
            return [`result = ${a} + ${b}`, `return(result)`];
        }

        const mulReturnMatch = lo.match(/^multiply\s+(.+?)\s+by\s+(.+?)(?:\s+using\s+.*)?\s+and\s+return\s+(?:the\s+)?(.+)/);
        if (mulReturnMatch) {
            const a = this._translateEnglishExpr(mulReturnMatch[1]);
            const b = this._translateEnglishExpr(mulReturnMatch[2]);
            return [`result = ${a} * ${b}`, `return(result)`];
        }

        const addMatch = lo.match(/^add\s+(.+?)\s+(?:to|and)\s+(.+)/);
        if (addMatch) {
            const a = this._translateEnglishExpr(addMatch[1]);
            const b = this._translateEnglishExpr(addMatch[2]);
            return [`result = ${a} + ${b}`];
        }

        const mulMatch = lo.match(/^multiply\s+(.+?)\s+by\s+(.+?)(\s+using\s+.*)?$/);
        if (mulMatch) {
            const a = this._translateEnglishExpr(mulMatch[1]);
            const b = this._translateEnglishExpr(mulMatch[2]);
            return [`result = ${a} * ${b}`];
        }

        const subMatch = lo.match(/^subtract\s+(.+?)\s+from\s+(.+)/);
        if (subMatch) {
            const a = this._translateEnglishExpr(subMatch[2]);
            const b = this._translateEnglishExpr(subMatch[1]);
            return [`result = ${a} - ${b}`];
        }

        const divMatch = lo.match(/^divide\s+(.+?)\s+by\s+(.+)/);
        if (divMatch) {
            const a = this._translateEnglishExpr(divMatch[1]);
            const b = this._translateEnglishExpr(divMatch[2]);
            return [`result = ${a} / ${b}`];
        }

        const stmt = this._translateEnglishStatement(text, lineNum);
        if (stmt) return [stmt];

        return null;
    }

    _translateEnglishStatement(text, lineNum) {
        const lo = text.toLowerCase().replace(/\.$/, '').trim();

        const returnMatch = lo.match(/^(?:return|give back|send back)\s+(?:the\s+)?(.+)/);
        if (returnMatch) {
            const val = this._translateEnglishExpr(returnMatch[1]);
            return `return(${val})`;
        }

        const resultCallMatch = lo.match(/^(?:set|store|put)\s+(\w+)\s+(?:to|as)\s+(?:the\s+)?(?:result of\s+)?(?:call(?:ing)?)\s+(\w+)\.(\w+)\s*(?:\(([^)]*)\)|with\s+(.+))?/);
        if (resultCallMatch) {
            const varName = resultCallMatch[1];
            const abs = resultCallMatch[2];
            const meth = resultCallMatch[3];
            const argsStr = resultCallMatch[4] || resultCallMatch[5] || '';
            const args = argsStr ? argsStr.replace(/\band\b/g, ',').split(',').map(s => s.trim()).filter(Boolean).join(', ') : '';
            return `${varName} = call(${abs}.${meth}(${args}))`;
        }

        const readMatch = lo.match(/^(?:set|store|put)\s+(\w+)\s+(?:to|as)\s+(?:the\s+)?(?:value\s+)?(?:read|loaded)\s+from\s+(\w+)\s+(?:at\s+)?(?:offset\s+)?(\w+)/);
        if (readMatch) {
            return `${readMatch[1]} = read(${readMatch[2]}, ${readMatch[3]})`;
        }

        const setMatch = lo.match(/^(?:set|store|put|assign)\s+(\w+)\s+(?:to|as|=)\s+(.+)/);
        if (setMatch) {
            const varName = setMatch[1];
            const expr = this._translateEnglishExpr(setMatch[2]);
            return `${varName} = ${expr}`;
        }

        const letMatch = lo.match(/^(?:let)\s+(\w+)\s+(?:be|equal|=)\s+(.+)/);
        if (letMatch) {
            const varName = letMatch[1];
            const expr = this._translateEnglishExpr(letMatch[2]);
            return `${varName} = ${expr}`;
        }

        const callMatch = lo.match(/^(?:call|run|execute|invoke)\s+(\w+)\.(\w+)\s*(?:\(([^)]*)\)|with\s+(.+))?/);
        if (callMatch) {
            const abs = callMatch[1];
            const meth = callMatch[2];
            const argsStr = callMatch[3] || callMatch[4] || '';
            const args = argsStr ? argsStr.replace(/\band\b/g, ',').split(',').map(s => s.trim()).filter(Boolean).join(', ') : '';
            return `call(${abs}.${meth}(${args}))`;
        }

        const writeMatch = lo.match(/^write\s+(.+)\s+to\s+(?:memory\s+)?(\w+)\s+(?:at\s+)?(?:offset\s+)?(\w+)/);
        if (writeMatch) {
            const val = this._translateEnglishExpr(writeMatch[1]);
            const cr = writeMatch[2];
            const offset = writeMatch[3];
            return `write(${cr}, ${offset}, ${val})`;
        }

        const ifMatch = lo.match(/^(?:if|when)\s+(\w+)\s+(is equal to|equals|is not|is greater than|is less than|is|==|!=|<|>|<=|>=)\s+(\w+)/);
        if (ifMatch) {
            let op;
            switch (ifMatch[2]) {
                case 'is equal to': case 'equals': case 'is': case '==': op = '=='; break;
                case 'is not': case '!=': op = '!='; break;
                case 'is greater than': case '>': op = '>'; break;
                case 'is less than': case '<': op = '<'; break;
                case '>=': op = '>='; break;
                case '<=': op = '<='; break;
                default: op = '=='; break;
            }
            return `if (${ifMatch[1]} ${op} ${ifMatch[3]}) {`;
        }

        if (lo === 'otherwise') {
            return '} else {';
        }

        if (lo === 'end if' || lo === 'end' || lo === '}') {
            return '}';
        }

        return null;
    }

    _translateEnglishExpr(expr) {
        let e = expr.trim().replace(/\.$/, '').trim();

        e = e.replace(/\b(\w+)\s+plus\s+(\w+)\b/gi, '$1 + $2');
        e = e.replace(/\b(\w+)\s+minus\s+(\w+)\b/gi, '$1 - $2');
        e = e.replace(/\b(\w+)\s+added\s+to\s+(\w+)\b/gi, '$2 + $1');
        e = e.replace(/\b(\w+)\s+subtracted\s+from\s+(\w+)\b/gi, '$2 - $1');
        e = e.replace(/\b(\w+)\s+times\s+(\w+)\b/gi, '$1 * $2');
        e = e.replace(/\b(\w+)\s+multiplied\s+by\s+(\w+)\b/gi, '$1 * $2');
        e = e.replace(/\b(\w+)\s+divided\s+by\s+(\w+)\b/gi, '$1 / $2');
        e = e.replace(/\b(\w+)\s+shifted\s+left\s+(?:by\s+)?(\d+)\b/gi, '$1 << $2');
        e = e.replace(/\b(\w+)\s+shifted\s+right\s+(?:by\s+)?(\d+)\b/gi, '$1 >> $2');

        return e.trim();
    }
}
