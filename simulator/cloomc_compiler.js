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
        this.DR_ARGS_START = 1;
        this.DR_ARGS_END = 3;
        this.DR_LOCALS_START = 4;
        this.DR_LOCALS_END = 11;
        this.DR_TEMP_START = 12;
        this.DR_TEMP_END = 15;
        // methodConventions: { 'ABSTRACTION_NAME': { 'MethodName': { index: N } } }
        // Populated externally from the AbstractionRegistry so the compiler can emit
        // the correct method selector in CALL instructions for capability methods.
        this.methodConventions = {};
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
        if (this._detectPetName(cleanSource)) {
            result = this.compilePetName(cleanSource, capabilities);
        } else if (this._detectEnglish(cleanSource)) {
            result = this.compileEnglish(cleanSource, capabilities);
        } else if (this._detectSymbolic(cleanSource)) {
            result = this.compileSymbolic(cleanSource, capabilities);
        } else if (this._detectLambda(cleanSource)) {
            result = this.compileLambda(cleanSource, capabilities);
        } else if (this._detectHaskell(cleanSource)) {
            result = this.compileHaskell(cleanSource, capabilities);
        } else if (this._detectCLOOMC(cleanSource)) {
            result = this.compileJS(cleanSource, capabilities);
        } else if (this._detectAssembly(cleanSource)) {
            result = this.compileAssembly(cleanSource, capabilities);
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
            const hasMethod = /^\s*(?:public\s+|private\s+)?method\s+\w+/m.test(source);
            const nameMatch = source.match(/^\s*(?:public\s+|private\s+)?method\s+(\w+)/m);
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

        // Expose private method names to _compileStatement so calls to same-abstraction
        // private methods compile to intra-LUMP BRANCH instructions rather than
        // ELOADCALL (which would fault with PRIVATE_METHOD at runtime).
        this._privateMethodNames = new Set(
            parsed.methods
                .filter(m => (m.visibility === 'private') && !m.aliasOf && !m.rawIsa)
                .map(m => m.name)
        );

        for (const method of parsed.methods) {
            if (method.aliasOf) {
                methods.push({ name: method.name, aliasOf: method.aliasOf, params: method.params || [], visibility: method.visibility || 'public' });
                continue;
            }
            if (method.rawIsa) {
                methods.push({ name: method.name, code: method.rawIsa, params: method.params || [], visibility: method.visibility || 'public', ...(method.sourceLines && { sourceLines: method.sourceLines }) });
                manifest.push({ name: method.name, mapping: [] });
                continue;
            }
            const result = this._compileMethod(method, rom, parsed.capabilities);
            if (result.errors.length > 0) {
                errors.push(...result.errors);
            } else {
                methods.push({ name: method.name, code: result.code, params: method.params || [], visibility: method.visibility || 'public', crossMethodRefs: result.crossMethodRefs, ...(method.sourceLines && { sourceLines: method.sourceLines }) });
                manifest.push({ name: method.name, mapping: result.manifest });
            }
        }

        this._privateMethodNames = null;

        if (errors.length === 0) {
            const _bodyIndex = new Map();
            for (const m of methods) {
                if (m.aliasOf) continue;
                const fp = m.code.join(',');
                if (_bodyIndex.has(fp)) {
                    m.aliasOf = _bodyIndex.get(fp);
                } else {
                    _bodyIndex.set(fp, m.name);
                }
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
            if (/^(?:public\s+|private\s+)?method\s+\w+\s*\([^)]*\)\s*=\s*.*\u03BB[a-z]\s*\./.test(t)) return true;
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
            if (method.aliasOf) {
                methods.push({ name: method.name, aliasOf: method.aliasOf, params: method.params || [], visibility: method.visibility || 'public', ...(method.sourceLines && { sourceLines: method.sourceLines }) });
                continue;
            }
            if (method.rawIsa) {
                methods.push({ name: method.name, code: method.rawIsa, params: method.params || [], visibility: method.visibility || 'public', ...(method.sourceLines && { sourceLines: method.sourceLines }) });
                manifest.push({ name: method.name, mapping: [] });
                continue;
            }
            const result = this._compileLambdaMethod(method, rom, parsed.capabilities, errors);
            if (result.errors.length > 0) {
                errors.push(...result.errors);
            } else {
                methods.push({ name: method.name, code: result.code, params: method.params || [], visibility: method.visibility || 'public', ...(method.sourceLines && { sourceLines: method.sourceLines }) });
                manifest.push({ name: method.name, mapping: result.manifest });
            }
        }

        if (errors.length === 0) {
            const _bodyIndex = new Map();
            for (const m of methods) {
                if (m.aliasOf) continue;
                const fp = m.code.join(',');
                if (_bodyIndex.has(fp)) {
                    m.aliasOf = _bodyIndex.get(fp);
                } else {
                    _bodyIndex.set(fp, m.name);
                }
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

            const absMatch = line.match(/^abstraction\s+(\w+)\s*\{/i);
            if (absMatch) {
                result.name = absMatch[1];
                i++;
                i = this._parseLambdaBody(lines, i, result, errors);
                break;
            }
            i++;
        }

        if (!result.name) {
            let _firstBadLine = '';
            for (const l of lines) {
                const t = l.trim();
                if (t && !t.startsWith('--')) { _firstBadLine = l; break; }
            }
            const _firstTok = _firstBadLine.trim().split(/\s+/)[0] || '';
            const _col = _firstTok ? CLOOMCCompiler._tokenCols(_firstBadLine, _firstTok) : {};
            errors.push({ line: 0, message: 'No abstraction declaration found. Expected: abstraction Name { ... }', ..._col });
        }
        return result;
    }

    _parseLambdaBody(lines, i, result, errors) {
        while (i < lines.length) {
            const line = lines[i].trim();
            if (!line || line.startsWith('--')) { i++; continue; }
            if (line === '}') { i++; break; }

            const capMatch = line.match(/^capabilities\s*\{/);
            if (capMatch) {
                const inlineMatch = line.match(/^capabilities\s*\{\s*(.*?)\s*\}$/);
                if (inlineMatch) {
                    if (inlineMatch[1]) {
                        for (const item of inlineMatch[1].split(',')) {
                            const cap = CLOOMCCompiler._parseCapItem(item);
                            if (cap) result.capabilities.push(cap);
                        }
                    }
                    i++;
                } else {
                    i++;
                    while (i < lines.length) {
                        const capLine = lines[i].trim();
                        if (capLine === '}') { i++; break; }
                        if (capLine && !capLine.startsWith('--')) {
                            for (const item of capLine.split(',')) {
                                const cap = CLOOMCCompiler._parseCapItem(item);
                                if (cap) result.capabilities.push(cap);
                            }
                        }
                        i++;
                    }
                }
                continue;
            }

            const visMatch = line.match(/^(public|private)\s+/);
            const visibility = visMatch ? visMatch[1] : 'public';
            const explicitVisibility = !!visMatch;
            const cleanLine = visMatch ? line.slice(visMatch[0].length) : line;

            const methodMatch = cleanLine.match(/^method\s+(\w+)\s*\(([^)]*)\)\s*=\s*(.+)$/);
            if (methodMatch) {
                const _rawLine0 = lines[i];
                const _ls0 = _rawLine0.length - _rawLine0.trimStart().length;
                const method = {
                    name: methodMatch[1],
                    params: methodMatch[2] ? methodMatch[2].split(',').map(p => p.trim()).filter(Boolean) : [],
                    expr: methodMatch[3].trim(),
                    exprOffset: _ls0 + (line.length - methodMatch[3].length),
                    startLine: i,
                    isLambda: true,
                    visibility,
                    explicitVisibility
                };
                i++;
                while (i < lines.length) {
                    const contLine = lines[i].trim();
                    if (!contLine || contLine.startsWith('--') || contLine.match(/^(?:public\s+|private\s+)?method\s+/) || contLine === '}') break;
                    method.expr += ' ' + contLine;
                    i++;
                }
                result.methods.push(method);
                continue;
            }

            const blockMethodMatch = cleanLine.match(/^method\s+(\w+)\s*\(([^)]*)\)\s*=\s*$/);
            if (blockMethodMatch) {
                const method = {
                    name: blockMethodMatch[1],
                    params: blockMethodMatch[2] ? blockMethodMatch[2].split(',').map(p => p.trim()).filter(Boolean) : [],
                    expr: '',
                    exprOffset: 0,
                    startLine: i,
                    isLambda: true,
                    visibility,
                    explicitVisibility
                };
                i++;
                while (i < lines.length) {
                    const contLine = lines[i].trim();
                    if (!contLine || contLine.startsWith('--')) { i++; continue; }
                    if (contLine.match(/^(?:public\s+|private\s+)?method\s+/) || contLine === '}') break;
                    method.expr += (method.expr ? ' ' : '') + contLine;
                    i++;
                }
                result.methods.push(method);
                continue;
            }

            i++;
        }
        for (let _mi = 0; _mi < result.methods.length; _mi++) {
            const _m = result.methods[_mi];
            const _end = _mi + 1 < result.methods.length ? result.methods[_mi + 1].startLine : i;
            _m.sourceLines = lines.slice(_m.startLine, _end).join('\n');
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
                    const negStart = i;
                    let num = '-';
                    i++;
                    while (i < input.length && /\d/.test(input[i])) { num += input[i]; i++; }
                    tokens.push({ type: 'number', value: parseInt(num), pos: negStart });
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
            if (input[i] === '=' && (i + 1 >= input.length || input[i + 1] !== '=')) { tokens.push({ type: 'op', value: '=', pos: i }); i++; continue; }

            if (/\d/.test(input[i])) {
                let num = '';
                const numStart = i;
                if (input[i] === '0' && i + 1 < input.length && input[i + 1] === 'x') {
                    num = '0x';
                    i += 2;
                    while (i < input.length && /[0-9a-fA-F]/.test(input[i])) { num += input[i]; i++; }
                } else {
                    while (i < input.length && /\d/.test(input[i])) { num += input[i]; i++; }
                }
                tokens.push({ type: 'number', value: parseInt(num), pos: numStart });
                continue;
            }

            if (/[a-zA-Z_]/.test(input[i])) {
                let ident = '';
                const identStart = i;
                while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) { ident += input[i]; i++; }
                if (i < input.length && input[i] === '.' && /[A-Z]/.test(ident[0])) {
                    ident += '.';
                    i++;
                    while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) { ident += input[i]; i++; }
                }
                if (ident === 'let') tokens.push({ type: 'let', pos: identStart });
                else if (ident === 'in') tokens.push({ type: 'in', pos: identStart });
                else if (ident === 'if') tokens.push({ type: 'hif', pos: identStart });
                else if (ident === 'then') tokens.push({ type: 'then', pos: identStart });
                else if (ident === 'else') tokens.push({ type: 'helse', pos: identStart });
                else tokens.push({ type: 'ident', value: ident, pos: identStart });
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
            const opPos = tokens[pos].pos;
            pos++;
            const right = this._parseLambdaApp(tokens, pos);
            left = { node: { type: 'binop', op: op, opPos: opPos, left: left.node, right: right.node }, pos: right.pos };
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
            return { node: { type: 'literal', value: t.value, pos: t.pos }, pos: pos + 1 };
        }

        if (t.type === 'ident') {
            return { node: { type: 'var', name: t.value, pos: t.pos }, pos: pos + 1 };
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
            if (pi + this.DR_ARGS_START <= this.DR_ARGS_END) {
                locals[method.params[pi]] = pi + this.DR_ARGS_START;
            } else {
                if (nextLocal > this.DR_LOCALS_END) {
                    errors.push({ line: method.startLine, message: 'Too many parameters' });
                    return { code: [], errors, manifest: [] };
                }
                locals[method.params[pi]] = nextLocal++;
            }
        }

        const ast = this._parseLambdaExpr(method.expr);
        const resultReg = this._emitHaskellExpr(ast, code, locals, rom, capNames, errors, manifest, method.startLine, method.exprOffset || 0);

        if (errors.length > 0) {
            return { code: [], errors, manifest: [] };
        }

        if (resultReg !== this.DR_ARGS_START) {
            code.push(this.encode(this.opcodes.IADD, 14, this.DR_ARGS_START, resultReg, 0));
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
            if (t.match(/^(?:public\s+|private\s+)?method\s+\w+\s*\([^)]*\)\s*=\s*/)) return true;
            if (t.includes('\\') && t.includes('->')) return true;
            if (t.match(/\bcase\b.*\bof\b/)) return true;
            if (t.match(/\blet\b.*\bin\b/)) return true;
            if (t.match(/\bpure\b\s/)) return true;
        }
        return false;
    }

    _detectCLOOMC(source) {
        const lines = source.split('\n');
        for (const line of lines) {
            const t = line.trim();
            if (!t || t.startsWith('//') || t.startsWith('--') || t.startsWith(';')) continue;
            if (/^abstraction\s+\w+/i.test(t)) return true;
            if (/^capabilities\s*\{/i.test(t)) return true;
            if (/^(?:public\s+|private\s+)?method\s+\w+/i.test(t)) return true;
        }
        return false;
    }

    _detectAssembly(source) {
        const CM_MNEMONICS = /^(LOAD|SAVE|CALL|RETURN|CHANGE|SWITCH|TPERM|LAMBDA|ELOADCALL|XLOADLAMBDA|DREAD|DWRITE|BFEXT|BFINS|MCMP|IADD|ISUB|BRANCH(?:EQ|NE|CS|CC|MI|PL|VS|VC|HI|LS|GE|LT|GT|LE|AL|NV)?|SHL|SHR|WORD|NOP)(\s|$|\.)/ ;
        const lines = source.split('\n');
        let score = 0;
        for (const line of lines) {
            const t = line.trim();
            if (!t) continue;
            if (t.startsWith(';')) { score++; continue; }
            if (/^[A-Za-z_]\w*:\s*$/.test(t)) { score++; continue; }
            if (CM_MNEMONICS.test(t)) { score += 2; continue; }
            if (/^\.pet\s+/i.test(t) || /^\.word\s+/i.test(t)) { score += 2; continue; }
        }
        return score >= 2;
    }

    compileAssembly(source, capabilities) {
        const asm = (typeof ChurchAssembler !== 'undefined') ? new ChurchAssembler() : null;
        if (!asm) {
            return {
                abstractionName: 'Assembly',
                language: 'assembly',
                methods: [],
                capabilities: [],
                errors: [{ line: 1, message: 'ChurchAssembler not available' }],
                profile: 'IoT'
            };
        }

        const result = asm.assemble(source);

        if (result.errors && result.errors.length > 0) {
            const normErrors = result.errors.map(e =>
                (e && typeof e === 'object' && 'line' in e && 'message' in e)
                    ? e
                    : { line: (e && e.line) || 0, message: String((e && e.message) || e) }
            );
            return {
                abstractionName: 'Assembly',
                language: 'assembly',
                methods: [],
                capabilities: [],
                errors: normErrors,
                profile: 'IoT'
            };
        }

        // Extract abstraction name: try specific "Name NS[..." header first,
        // then any first meaningful ; comment line, then first label, then default.
        let absName = 'Assembly';
        const headerMatch = source.match(/^;\s*(?:Disassembly\s+of\s+\S+\s+)?([^\n@]+?)\s+(?:NS\[|\@\s*0x)/m);
        if (headerMatch) {
            absName = headerMatch[1].trim();
        } else {
            // First meaningful ; comment line — skip separator-only lines (===, ---, ***, etc.)
            // and lines whose content is entirely non-alphanumeric punctuation/whitespace.
            const commentLines = [];
            const commentRe = /^;\s*(.+?)\s*$/mg;
            let cm;
            while ((cm = commentRe.exec(source)) !== null) { commentLines.push(cm[1]); }
            const meaningfulComment = commentLines.find(c => /[A-Za-z0-9]/.test(c));
            if (meaningfulComment) {
                absName = meaningfulComment.slice(0, 64).trim();
            } else {
                const firstLabel = Object.keys(result.labels || {})[0];
                if (firstLabel) absName = firstLabel;
            }
        }

        const caps = result.capabilities || [];
        const words = Array.from(result.words || []);
        const asmLineNums = result.lineNums || [];

        return {
            abstractionName: absName,
            language: 'assembly',
            methods: [{ name: 'run', code: words, sourceLines: source, lineNums: asmLineNums }],
            capabilities: caps,
            errors: [],
            lineNums: asmLineNums,
            profile: (typeof detectProfile === 'function') ? detectProfile([{ code: words }]) : 'IoT',
            manifest: null
        };
    }

    _buildROM(declaredCaps, uploadCaps) {
        const rom = {};
        const capNames = declaredCaps || [];
        for (let i = 0; i < capNames.length; i++) {
            rom[(typeof capNames[i] === 'string' ? capNames[i] : capNames[i].name || '').toUpperCase()] = i;
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

    // Parse a single "NAME [RIGHTS]" capability item from a capabilities { } block.
    // Examples: "LED0 RW" → {name:'LED0', rights:['R','W']}
    //           "Memory E" → {name:'Memory', rights:['E']}
    //           "LED0" → {name:'LED0', rights:[]}  (missing rights — caller should warn/error)
    static _parseCapItem(itemStr) {
        const tokens = itemStr.trim().split(/\s+/).filter(Boolean);
        if (!tokens.length) return null;
        const name = tokens[0];
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return null;
        const rights = [];
        for (const t of tokens.slice(1)) {
            if (/^[RWXErwxe]+$/.test(t)) {
                for (const c of t.toUpperCase()) {
                    if (!rights.includes(c)) rights.push(c);
                }
            }
        }
        return { name, rights };
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

            const absMatch = line.match(/^abstraction\s+(\w+)\s*\{/i);
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
        let _commentBlockStart = -1; // start of consecutive // comment block preceding a method
        while (i < lines.length) {
            const line = lines[i].trim();
            if (!line) { _commentBlockStart = -1; i++; continue; }
            if (line.startsWith('//')) {
                if (_commentBlockStart < 0) _commentBlockStart = i;
                i++; continue;
            }
            if (line === '}') return i + 1;

            const capMatch = line.match(/^capabilities\s*\{/);
            if (capMatch) {
                _commentBlockStart = -1;
                const inlineMatch = line.match(/^capabilities\s*\{\s*(.*?)\s*\}$/);
                if (inlineMatch) {
                    if (inlineMatch[1]) {
                        for (const item of inlineMatch[1].split(',')) {
                            const cap = CLOOMCCompiler._parseCapItem(item);
                            if (cap) result.capabilities.push(cap);
                        }
                    }
                    i++;
                } else {
                    i++;
                    while (i < lines.length) {
                        const capLine = lines[i].trim();
                        if (capLine === '}') { i++; break; }
                        if (capLine && !capLine.startsWith('//')) {
                            for (const item of capLine.split(',')) {
                                const cap = CLOOMCCompiler._parseCapItem(item);
                                if (cap) result.capabilities.push(cap);
                            }
                        }
                        i++;
                    }
                }
                continue;
            }

            // Strip optional public/private visibility prefix
            const visMatch = line.match(/^(public|private)\s+/);
            const visibility = visMatch ? visMatch[1] : 'public';
            const explicitVisibility = !!visMatch;
            const cleanLine = visMatch ? line.slice(visMatch[0].length) : line;

            // method Name = aliasOf Target;  (explicit alias, no code body)
            const aliasMatch = cleanLine.match(/^method\s+(\w+)\s*(?:\([^)]*\))?\s*=\s*aliasOf\s+(\w+)\s*;/);
            if (aliasMatch) {
                _commentBlockStart = -1;
                result.methods.push({ name: aliasMatch[1], aliasOf: aliasMatch[2], params: [], body: [], startLine: i, visibility, explicitVisibility });
                i++;
                continue;
            }

            // method Name [RAW ISA] { 0xHEX ... }  (inline ISA words)
            const rawIsaMatch = cleanLine.match(/^method\s+(\w+)\s*(?:\([^)]*\))?\s*\[RAW ISA\]\s*\{/);
            if (rawIsaMatch) {
                const _rawIsaSrcStart = _commentBlockStart >= 0 ? _commentBlockStart : i;
                _commentBlockStart = -1;
                const rawWords = [];
                i++;
                while (i < lines.length) {
                    const t = lines[i].trim();
                    if (t === '}') { i++; break; }
                    if (t && !t.startsWith('//')) {
                        for (const tok of t.split(/\s+/)) {
                            if (/^0x[0-9a-fA-F]+$/.test(tok)) rawWords.push(parseInt(tok, 16) >>> 0);
                        }
                    }
                    i++;
                }
                const _rawIsaMethod = { name: rawIsaMatch[1], rawIsa: rawWords, params: [], body: [], startLine: _rawIsaSrcStart, visibility, explicitVisibility };
                _rawIsaMethod.sourceLines = lines.slice(_rawIsaSrcStart, i).join('\n');
                result.methods.push(_rawIsaMethod);
                continue;
            }

            // method Name(...) { ... }  or  method Name { ... }  (optional parens)
            const methodMatch = cleanLine.match(/^method\s+(\w+)\s*(?:\(([^)]*)\))?\s*\{/);
            if (methodMatch) {
                const _srcStart = _commentBlockStart >= 0 ? _commentBlockStart : i;
                _commentBlockStart = -1;
                const method = { name: methodMatch[1], params: [], body: [], startLine: i, visibility, explicitVisibility };
                if (methodMatch[2] && methodMatch[2].trim()) {
                    method.params = methodMatch[2].split(',').map(p => p.trim()).filter(Boolean);
                }
                i++;
                let braceDepth = 1;
                while (i < lines.length && braceDepth > 0) {
                    const trimmed = lines[i].trim();
                    if (trimmed === '}') {
                        braceDepth--;
                        if (braceDepth === 0) { i++; break; }
                        method.body.push({ text: trimmed, lineNum: i, rawLine: lines[i] });
                        i++;
                        continue;
                    }
                    if (trimmed === '{') {
                        braceDepth++;
                        method.body.push({ text: trimmed, lineNum: i, rawLine: lines[i] });
                        i++;
                        continue;
                    }
                    for (const ch of trimmed) {
                        if (ch === '{') braceDepth++;
                        else if (ch === '}') braceDepth--;
                    }
                    if (braceDepth > 0) {
                        method.body.push({ text: trimmed, lineNum: i, rawLine: lines[i] });
                    } else {
                        const beforeClose = trimmed.replace(/\}$/, '').trim();
                        if (beforeClose) method.body.push({ text: beforeClose, lineNum: i, rawLine: lines[i] });
                    }
                    i++;
                }
                method.sourceLines = lines.slice(_srcStart, i).join('\n');
                result.methods.push(method);
                continue;
            }

            _commentBlockStart = -1;
            i++;
        }
        return i;
    }

    _parseCRFull(name) {
        const up = (name || '').toUpperCase();
        const direct = up.match(/^CR(\d+)$/);
        if (direct) return parseInt(direct[1]);
        if (up === 'CODE') return 14;
        if (up === 'CLIST') return 6;
        if (this._crLocals && this._crLocals[name] !== undefined) return this._crLocals[name];
        if (this._crCompileMethod) {
            const idx = this._crCompileMethod.params.indexOf(name);
            if (idx >= 0) return 2 + idx;
        }
        return 0;
    }

    _compileMethod(method, rom, capNames) {
        const errors = [];
        const code = [];
        const manifest = [];
        const locals = {};
        let nextLocal = this.DR_LOCALS_START;
        this._crLocals = {};
        this._crAlloc = { next: 7 };
        this._crCompileMethod = method;

        for (const param of method.params) {
            const paramIdx = method.params.indexOf(param);
            if (paramIdx + this.DR_ARGS_START <= this.DR_ARGS_END) {
                locals[param] = paramIdx + this.DR_ARGS_START;
            } else {
                if (nextLocal > this.DR_LOCALS_END) {
                    errors.push({ line: method.startLine, message: `Too many parameters — max ${this.DR_LOCALS_END - this.DR_LOCALS_START + 1 + this.DR_ARGS_END - this.DR_ARGS_START + 1}` });
                    return { code: [], errors, manifest: [] };
                }
                locals[param] = nextLocal++;
            }
        }

        const labels = {};
        const labelRefs = [];
        this._crossMethodRefs = [];

        for (const stmt of method.body) {
            if (!stmt.text || stmt.text.startsWith('//') || stmt.text.startsWith(';')) continue;

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
                errors.push({ line: ref.lineNum, message: `Undefined label: ${ref.label}`, ...CLOOMCCompiler._tokenCols(ref.rawLine, ref.label) });
            } else {
                const relOffset = target - ref.addr;
                code[ref.addr] = (code[ref.addr] & ~0x7FFF) | (relOffset & 0x7FFF);
                code[ref.addr] = code[ref.addr] >>> 0;
            }
        }

        if (errors.length === 0) {
            const lastOpcode = code.length > 0 ? (code[code.length - 1] >>> 27) : -1;
            if (lastOpcode !== this.opcodes.RETURN) {
                manifest.push({ src: method.startLine, addr: code.length, desc: 'RETURN (implicit)' });
                code.push(this.encode(this.opcodes.RETURN, 14, 0, 0, 0));
            }
        }

        const crossMethodRefs = this._crossMethodRefs;
        this._crossMethodRefs = null;
        return { code, errors, manifest, crossMethodRefs };
    }

    _allocTemp(locals) {
        for (let r = this.DR_TEMP_START; r <= this.DR_TEMP_END; r++) {
            const used = Object.values(locals).includes(r);
            if (!used) return r;
        }
        return this.DR_TEMP_START;
    }

    // NOTE: let-bindings are method-scoped, not block-scoped. A variable
    // declared with `let x = ...` inside an if or while body occupies the same
    // register slot for the lifetime of the enclosing method — the Church
    // Machine ISA has no stack frame, so block-level scoping cannot be enforced
    // here. Callers must not rely on a binding being restricted to the block in
    // which it first appears.
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

    _resolveExpr(expr, code, locals, rom, errors, lineNum, method, rawLine = null) {
        expr = expr.trim();

        const numMatch = expr.match(/^(0x[0-9a-fA-F]+|\d+)$/);
        if (numMatch) {
            const val = parseInt(numMatch[1]);
            if (val > 2147483647 || val < -2147483648) {
                errors.push({ line: lineNum, message: `Literal ${val} is out of range for a 32-bit Church Machine register (must be between -2147483648 and 2147483647)` });
                return this._allocTemp(locals);
            }
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
            const leftDR = this._resolveExpr(addMatch[1], code, locals, rom, errors, lineNum, method, rawLine);
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
            const rightDR = this._resolveExpr(rightExpr, code, locals, rom, errors, lineNum, method, rawLine);
            const dr = this._allocTemp(locals);
            code.push(this.encode(this.opcodes.IADD, 14, dr, leftDR, rightDR));
            return dr;
        }

        const subMatch = expr.match(/^(\w+)\s*-\s*(.+)$/);
        if (subMatch) {
            const leftDR = this._resolveExpr(subMatch[1], code, locals, rom, errors, lineNum, method, rawLine);
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
            const rightDR = this._resolveExpr(rightExpr, code, locals, rom, errors, lineNum, method, rawLine);
            const dr = this._allocTemp(locals);
            code.push(this.encode(this.opcodes.ISUB, 14, dr, leftDR, rightDR));
            return dr;
        }

        const mulMatch = expr.match(/^(\w+)\s*\*\s*(.+)$/);
        if (mulMatch) {
            const leftDR = this._resolveExpr(mulMatch[1], code, locals, rom, errors, lineNum, method, rawLine);
            const rightExpr = mulMatch[2].trim();
            const rightDR = this._resolveExpr(rightExpr, code, locals, rom, errors, lineNum, method, rawLine);
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
            const srcDR = this._resolveExpr(shlMatch[1], code, locals, rom, errors, lineNum, method, rawLine);
            const dr = this._allocTemp(locals);
            code.push(this.encode(this.opcodes.SHL, 14, dr, srcDR, parseInt(shlMatch[2])));
            return dr;
        }

        // Arithmetic (signed) shift right: x >>s n  — sets imm[5]=1 (ASR mode)
        const asrMatch = expr.match(/^(\w+)\s*>>s\s*(\d+)$/);
        if (asrMatch) {
            const srcDR = this._resolveExpr(asrMatch[1], code, locals, rom, errors, lineNum, method, rawLine);
            const dr = this._allocTemp(locals);
            const shamt = parseInt(asrMatch[2]) & 0x1F;
            code.push(this.encode(this.opcodes.SHR, 14, dr, srcDR, (1 << 5) | shamt));
            return dr;
        }

        const shrMatch = expr.match(/^(\w+)\s*>>\s*(\d+)$/);
        if (shrMatch) {
            const srcDR = this._resolveExpr(shrMatch[1], code, locals, rom, errors, lineNum, method, rawLine);
            const dr = this._allocTemp(locals);
            code.push(this.encode(this.opcodes.SHR, 14, dr, srcDR, parseInt(shrMatch[2])));
            return dr;
        }

        const readMatch = expr.match(/^(?:read|DREAD)\s*\(\s*(\w+)\s*,\s*(.+)\s*\)$/);
        if (readMatch) {
            const crIdx = this._parseCRFull(readMatch[1]);
            const offsetExpr = readMatch[2].trim();
            const offset = parseInt(offsetExpr) || 0;
            const dr = this._allocTemp(locals);
            code.push(this.encode(this.opcodes.DREAD, 14, dr, crIdx, offset & 0x7FFF));
            return dr;
        }

        const bfextMatch = expr.match(/^bfext\s*\(\s*(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
        if (bfextMatch) {
            const srcDR = this._resolveExpr(bfextMatch[1], code, locals, rom, errors, lineNum, method, rawLine);
            const pos = parseInt(bfextMatch[2]);
            const width = parseInt(bfextMatch[3]);
            if (width < 1) {
                errors.push({ line: lineNum, message: `BFEXT: width must be ≥ 1 (got ${width})` });
                return 0;
            }
            if (pos + width > 32) {
                errors.push({ line: lineNum, message: `BFEXT: pos+width must be ≤ 32 (pos=${pos}, width=${width}, sum=${pos + width})` });
                return 0;
            }
            const dr = this._allocTemp(locals);
            const imm = ((pos & 0x1F) << 5) | (width & 0x1F);
            code.push(this.encode(this.opcodes.BFEXT, 14, dr, srcDR, imm));
            return dr;
        }

        errors.push({ line: lineNum, message: `Cannot resolve expression: ${expr}`, ...CLOOMCCompiler._tokenCols(rawLine, expr) });
        return 0;
    }

    _parseCR(name) {
        const match = name.match(/^CR(\d+)$/);
        if (match) return parseInt(match[1]);
        if (name === 'CODE' || name === 'CR14') return 14;
        if (name === 'CLIST' || name === 'CR6') return 6;
        return 0;
    }

    static _tokenCols(rawLine, token, startOffset = 0) {
        if (!rawLine || !token) return {};
        const idx = rawLine.indexOf(token, startOffset);
        if (idx < 0) return {};
        return { colStart: idx, colEnd: idx + token.length };
    }

    // Return the closest key in `candidates` to `name` (case-insensitive),
    // or null if the best distance exceeds `maxDist` (default 3).
    static _closestMatch(name, candidates, maxDist = 3) {
        const a = name.toUpperCase();
        let best = null, bestDist = maxDist + 1;
        for (const c of candidates) {
            const b = c.toUpperCase();
            // Levenshtein
            const m = a.length, n = b.length;
            const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
            for (let j = 0; j <= n; j++) dp[0][j] = j;
            for (let i = 1; i <= m; i++) {
                for (let j = 1; j <= n; j++) {
                    dp[i][j] = a[i-1] === b[j-1]
                        ? dp[i-1][j-1]
                        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
                }
            }
            const dist = dp[m][n];
            if (dist < bestDist) { bestDist = dist; best = c; }
        }
        return best;
    }

    _compileStatement(stmt, code, locals, rom, capNames, labels, labelRefs, errors, manifest, method) {
        const text = stmt.text.trim().replace(/;$/, '');
        if (!text || text.startsWith('//')) return;

        const returnMatch = text.match(/^(?:RETURN|return)(?:\s*\(\s*(.*?)\s*\)|\s+(.+))?$/);
        if (returnMatch) {
            const _returnExpr = returnMatch[1] !== undefined ? returnMatch[1] : (returnMatch[2] ? returnMatch[2].trim() : undefined);
            if (_returnExpr) {
                const parts = _returnExpr.split(',').map(s => s.trim());
                for (let i = 0; i < parts.length && i + this.DR_ARGS_START <= this.DR_ARGS_END; i++) {
                    const targetDR = i + this.DR_ARGS_START;
                    const valDR = this._resolveExpr(parts[i], code, locals, rom, errors, stmt.lineNum, method, stmt.rawLine);
                    if (valDR !== targetDR) {
                        code.push(this.encode(this.opcodes.IADD, 14, targetDR, valDR, 0));
                    }
                }
            }
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: 'RETURN' });
            code.push(this.encode(this.opcodes.RETURN, 14, 0, 0, 0));
            return;
        }

        const writeMatch = text.match(/^(?:write|DWRITE)\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(.+)\s*\)$/);
        if (writeMatch) {
            const crIdx = this._parseCRFull(writeMatch[1]);
            const offset = parseInt(writeMatch[2]) || 0;
            const valDR = this._resolveExpr(writeMatch[3], code, locals, rom, errors, stmt.lineNum, method, stmt.rawLine);
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: `DWRITE CR${crIdx}, ${offset}` });
            code.push(this.encode(this.opcodes.DWRITE, 14, valDR, crIdx, offset & 0x7FFF));
            return;
        }

        const bfinsMatch = text.match(/^bfins\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
        if (bfinsMatch) {
            const dstDR = this._resolveExpr(bfinsMatch[1], code, locals, rom, errors, stmt.lineNum, method, stmt.rawLine);
            const valDR = this._resolveExpr(bfinsMatch[2], code, locals, rom, errors, stmt.lineNum, method, stmt.rawLine);
            const pos = parseInt(bfinsMatch[3]);
            const width = parseInt(bfinsMatch[4]);
            if (width < 1) {
                errors.push({ line: stmt.lineNum, message: `BFINS: width must be ≥ 1 (got ${width})` });
                return;
            }
            if (pos + width > 32) {
                errors.push({ line: stmt.lineNum, message: `BFINS: pos+width must be ≤ 32 (pos=${pos}, width=${width}, sum=${pos + width})` });
                return;
            }
            const imm = ((pos & 0x1F) << 5) | (width & 0x1F);
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: `BFINS DR${dstDR}, DR${valDR}` });
            code.push(this.encode(this.opcodes.BFINS, 14, dstDR, valDR, imm));
            return;
        }

        // tperm(var, PERM) — restrict permissions on a capability register
        const tpermMatch = text.match(/^tperm\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)$/);
        if (tpermMatch) {
            const crIdx = this._parseCRFull(tpermMatch[1]);
            const permName = tpermMatch[2].toUpperCase();
            const permBits = { E: 1, W: 2, R: 4, F: 8, EW: 3, ER: 5, EF: 9, WR: 6, WF: 10, RF: 12, EWR: 7, EWF: 11, ERF: 13, WRF: 14, EWRF: 15 };
            const permMask = permBits[permName] !== undefined ? permBits[permName] : parseInt(permName) || 0;
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: `TPERM CR${crIdx}, #${permName}` });
            code.push(this.encode(this.opcodes.TPERM, 14, crIdx, 0, permMask));
            return;
        }

        const callClistMatch = text.match(/^CALL\s+(?:CR)?(\d+)\s*,\s*CR(\d+)\s*,\s*#(\d+)$/i);
        if (callClistMatch) {
            const methodIdx = parseInt(callClistMatch[1]) & 0xF;
            const srcCR = parseInt(callClistMatch[2]) & 0xF;
            const offset = parseInt(callClistMatch[3]) & 0x7FFF;
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: `CALL CR${methodIdx}, CR${srcCR}, #${offset} (c-list indexed)` });
            code.push(this.encode(this.opcodes.CALL, 14, methodIdx, srcCR, offset));
            return;
        }

        // CALL Abstraction.Method(args) — uppercase keyword form; alias for call(Abstraction.Method(args))
        // Compiles to ELOADCALL exactly like the lowercase wrapper form.
        const callDotMatch = text.match(/^CALL\s+(\w+)\.(\w+)\s*\(\s*(.*?)\s*\)$/i);
        if (callDotMatch && !/^CR\d+$/i.test(callDotMatch[1])) {
            const absName    = callDotMatch[1].toUpperCase();
            const methodName = callDotMatch[2];
            const argStr     = callDotMatch[3];
            const _leadingWS     = stmt.rawLine ? stmt.rawLine.length - stmt.rawLine.trimStart().length : 0;
            const _absNameOffset = _leadingWS + (text.indexOf(callDotMatch[1]));
            const _methodOffset  = _leadingWS + (text.indexOf(callDotMatch[1] + '.' + callDotMatch[2]) + callDotMatch[1].length + 1);
            const clistOffset = rom[absName];
            if (clistOffset === undefined) {
                const _suggest = CLOOMCCompiler._closestMatch(callDotMatch[1], Object.keys(rom));
                const _hint = _suggest ? ` Did you mean '${_suggest}'?` : '';
                errors.push({ line: stmt.lineNum, message: `Unknown abstraction '${callDotMatch[1]}' — not in capabilities list.${_hint} Available: ${Object.keys(rom).join(', ')}`, ...CLOOMCCompiler._tokenCols(stmt.rawLine, callDotMatch[1], _absNameOffset) });
                return;
            }
            if (argStr) {
                const args = argStr.split(',').map(s => s.trim()).filter(Boolean);
                for (let a = 0; a < args.length && a + this.DR_ARGS_START <= this.DR_ARGS_END; a++) {
                    const targetDR = a + this.DR_ARGS_START;
                    const argDR = this._resolveExpr(args[a], code, locals, rom, errors, stmt.lineNum, method, stmt.rawLine);
                    if (argDR !== targetDR) code.push(this.encode(this.opcodes.IADD, 14, targetDR, argDR, 0));
                }
            }
            const convEntry = this.methodConventions[absName];
            if (!convEntry) {
                errors.push({ line: stmt.lineNum, message: `No method conventions registered for '${callDotMatch[1]}'; cannot resolve '${methodName}'.`, ...CLOOMCCompiler._tokenCols(stmt.rawLine, callDotMatch[1], _absNameOffset) });
                return;
            }
            if (convEntry[methodName] === undefined) {
                const known = Object.keys(convEntry).filter(k => !k.startsWith('_reserved')).join(', ');
                errors.push({ line: stmt.lineNum, message: `Unknown method '${methodName}' on '${callDotMatch[1]}'. Known methods: ${known}`, ...CLOOMCCompiler._tokenCols(stmt.rawLine, methodName, _methodOffset) });
                return;
            }
            const rawEntry = convEntry[methodName];
            const methodSelector = typeof rawEntry === 'object' ? (rawEntry.index || 0) : rawEntry;
            const eloadcallMethodIdx = methodSelector + 1;
            if (methodSelector < 0 || methodSelector > 126) {
                errors.push({ line: stmt.lineNum, message: `Method index ${methodSelector} for '${callDotMatch[1]}.${methodName}' is out of range (0–126).` });
                return;
            }
            if (clistOffset < 0 || clistOffset > 255) {
                errors.push({ line: stmt.lineNum, message: `C-list row ${clistOffset} for '${callDotMatch[1]}' is out of range (0–255).` });
                return;
            }
            const eloadcallImm = (eloadcallMethodIdx << 8) | clistOffset;
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: `ELOADCALL CR0, CR6[${clistOffset}], method=${eloadcallMethodIdx} -> ${callDotMatch[1]}.${methodName}` });
            code.push(this.encode(this.opcodes.ELOADCALL, 14, 0, 6, eloadcallImm));
            return;
        }

        // Abstraction.Method(args) — bare dot-notation; CALL is implied by the compiler.
        // The most natural CLOOMC++ form: Scheduler.pause(10), Salvation.main(), etc.
        const bareDotMatch = text.match(/^(\w+)\.(\w+)\s*\(\s*(.*?)\s*\)$/);
        if (bareDotMatch && !/^recall$/i.test(bareDotMatch[1]) && !/^relambda$/i.test(bareDotMatch[1])) {
            const absName    = bareDotMatch[1].toUpperCase();
            const methodName = bareDotMatch[2];
            const argStr     = bareDotMatch[3];
            const _leadingWS     = stmt.rawLine ? stmt.rawLine.length - stmt.rawLine.trimStart().length : 0;
            const _absNameOffset = _leadingWS + (text.indexOf(bareDotMatch[1]));
            const _methodOffset  = _leadingWS + (text.indexOf(bareDotMatch[1] + '.' + bareDotMatch[2]) + bareDotMatch[1].length + 1);
            const clistOffset = rom[absName];
            if (clistOffset === undefined) {
                const _suggest = CLOOMCCompiler._closestMatch(bareDotMatch[1], Object.keys(rom));
                const _hint = _suggest ? ` Did you mean '${_suggest}'?` : '';
                errors.push({ line: stmt.lineNum, message: `Unknown abstraction '${bareDotMatch[1]}' — not in capabilities list.${_hint} Available: ${Object.keys(rom).join(', ')}`, ...CLOOMCCompiler._tokenCols(stmt.rawLine, bareDotMatch[1], _absNameOffset) });
                return;
            }
            if (argStr) {
                const args = argStr.split(',').map(s => s.trim()).filter(Boolean);
                for (let a = 0; a < args.length && a + this.DR_ARGS_START <= this.DR_ARGS_END; a++) {
                    const targetDR = a + this.DR_ARGS_START;
                    const argDR = this._resolveExpr(args[a], code, locals, rom, errors, stmt.lineNum, method, stmt.rawLine);
                    if (argDR !== targetDR) code.push(this.encode(this.opcodes.IADD, 14, targetDR, argDR, 0));
                }
            }
            const convEntry = this.methodConventions[absName];
            if (!convEntry) {
                errors.push({ line: stmt.lineNum, message: `No method conventions registered for '${bareDotMatch[1]}'; cannot resolve '${methodName}'.`, ...CLOOMCCompiler._tokenCols(stmt.rawLine, bareDotMatch[1], _absNameOffset) });
                return;
            }
            if (convEntry[methodName] === undefined) {
                const known = Object.keys(convEntry).filter(k => !k.startsWith('_reserved')).join(', ');
                errors.push({ line: stmt.lineNum, message: `Unknown method '${methodName}' on '${bareDotMatch[1]}'. Known methods: ${known}`, ...CLOOMCCompiler._tokenCols(stmt.rawLine, methodName, _methodOffset) });
                return;
            }
            const rawEntry = convEntry[methodName];
            const methodSelector = typeof rawEntry === 'object' ? (rawEntry.index || 0) : rawEntry;
            const eloadcallMethodIdx = methodSelector + 1;
            if (methodSelector < 0 || methodSelector > 126) {
                errors.push({ line: stmt.lineNum, message: `Method index ${methodSelector} for '${bareDotMatch[1]}.${methodName}' is out of range (0–126).` });
                return;
            }
            if (clistOffset < 0 || clistOffset > 255) {
                errors.push({ line: stmt.lineNum, message: `C-list row ${clistOffset} for '${bareDotMatch[1]}' is out of range (0–255).` });
                return;
            }
            const eloadcallImm = (eloadcallMethodIdx << 8) | clistOffset;
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: `ELOADCALL CR0, CR6[${clistOffset}], method=${eloadcallMethodIdx} -> ${bareDotMatch[1]}.${methodName} (implied call)` });
            code.push(this.encode(this.opcodes.ELOADCALL, 14, 0, 6, eloadcallImm));
            return;
        }

        // recall() — re-call the current abstraction (CR6) directly → CALL CR6
        const recallMatch = text.match(/^recall\s*\(\s*(.*?)\s*\)$/);
        if (recallMatch) {
            const argStr = recallMatch[1];
            if (argStr) {
                const args = argStr.split(',').map(s => s.trim()).filter(Boolean);
                for (let a = 0; a < args.length && a + this.DR_ARGS_START <= this.DR_ARGS_END; a++) {
                    const targetDR = a + this.DR_ARGS_START;
                    const argDR = this._resolveExpr(args[a], code, locals, rom, errors, stmt.lineNum, method, stmt.rawLine);
                    if (argDR !== targetDR) {
                        code.push(this.encode(this.opcodes.IADD, 14, targetDR, argDR, 0));
                    }
                }
            }
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: 'CALL CR6 (recall self)' });
            code.push(this.encode(this.opcodes.CALL, 14, 6, 0, 0));
            return;
        }

        // relambda() — lightweight self-recursion via LAMBDA CR6 (SZ=0 frame, no namespace swap)
        const relambdaMatch = text.match(/^relambda\s*\(\s*(.*?)\s*\)$/);
        if (relambdaMatch) {
            const argStr = relambdaMatch[1];
            if (argStr) {
                const args = argStr.split(',').map(s => s.trim()).filter(Boolean);
                for (let a = 0; a < args.length && a + this.DR_ARGS_START <= this.DR_ARGS_END; a++) {
                    const targetDR = a + this.DR_ARGS_START;
                    const argDR = this._resolveExpr(args[a], code, locals, rom, errors, stmt.lineNum, method, stmt.rawLine);
                    if (argDR !== targetDR) {
                        code.push(this.encode(this.opcodes.IADD, 14, targetDR, argDR, 0));
                    }
                }
            }
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: 'LAMBDA CR6 (relambda self — lightweight)' });
            code.push(this.encode(this.opcodes.LAMBDA, 14, 6, 0, 0));
            return;
        }

        // call(cr_var) — bare call through a capability register (no arg marshalling)
        const callCapMatch = text.match(/^call\s*\(\s*(\w+)\s*\)$/);
        if (callCapMatch) {
            const crIdx = this._parseCRFull(callCapMatch[1]);
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: `CALL CR${crIdx}` });
            code.push(this.encode(this.opcodes.CALL, 14, crIdx, crIdx, 0));
            return;
        }

        const _callRegex = /^(?:(?:var|let|const)\s+)?(?:(\w+)\s*=\s*)?call\s*\(\s*(\w+)\.(\w+)\s*\(\s*(.*?)\s*\)\s*\)$/d;
        const callMatch = _callRegex.exec(text);
        if (callMatch) {
            const resultVar = callMatch[1] || null;
            const absName = callMatch[2].toUpperCase();
            const methodName = callMatch[3];
            const argStr = callMatch[4];

            // Compute the leading-whitespace offset so that positions from the
            // trimmed `text` can be mapped back to columns in the raw source line.
            const _leadingWS = stmt.rawLine ? stmt.rawLine.length - stmt.rawLine.trimStart().length : 0;
            const _absNameOffset  = _leadingWS + callMatch.indices[2][0];
            const _methodOffset   = _leadingWS + callMatch.indices[3][0];

            const clistOffset = rom[absName];
            if (clistOffset === undefined) {
                const _suggest = CLOOMCCompiler._closestMatch(callMatch[2], Object.keys(rom));
                const _hint = _suggest ? ` Did you mean '${_suggest}'?` : '';
                errors.push({ line: stmt.lineNum, message: `Unknown abstraction '${callMatch[2]}' — not in capabilities list.${_hint} Available: ${Object.keys(rom).join(', ')}`, ...CLOOMCCompiler._tokenCols(stmt.rawLine, callMatch[2], _absNameOffset) });
                return;
            }

            if (argStr) {
                const args = argStr.split(',').map(s => s.trim());
                for (let a = 0; a < args.length && a + this.DR_ARGS_START <= this.DR_ARGS_END; a++) {
                    const targetDR = a + this.DR_ARGS_START;
                    const argDR = this._resolveExpr(args[a], code, locals, rom, errors, stmt.lineNum, method, stmt.rawLine);
                    if (argDR !== targetDR) {
                        code.push(this.encode(this.opcodes.IADD, 14, targetDR, argDR, 0));
                    }
                }
            }

            // Look up the method selector from conventions (e.g. Billing.Balance = index 4).
            // imm15=0 is the fast-path (no table), so valid method selectors are 1-based.
            // Unresolved method names produce a compile error to prevent silent misdispatch.
            const convEntry = this.methodConventions[absName];
            if (!convEntry) {
                errors.push({ line: stmt.lineNum, message: `No method conventions registered for '${callMatch[2]}'; cannot resolve '${methodName}'. Ensure the abstraction declares methods before compiling.`, ...CLOOMCCompiler._tokenCols(stmt.rawLine, callMatch[2], _absNameOffset) });
                return;
            }
            if (convEntry[methodName] === undefined) {
                const known = Object.keys(convEntry).join(', ');
                errors.push({ line: stmt.lineNum, message: `Unknown method '${methodName}' on '${callMatch[2]}'. Known methods: ${known}`, ...CLOOMCCompiler._tokenCols(stmt.rawLine, methodName, _methodOffset) });
                return;
            }
            const rawEntry = convEntry[methodName];
            const methodSelector = typeof rawEntry === 'object' ? (rawEntry.index || 0) : rawEntry;

            // Fused ELOADCALL: replaces LOAD CR0 + CALL CR0 with a single instruction.
            // imm15[14:8] = method index (1-based; 0 = fast-path / no table; valid range 1–127).
            // imm15[7:0]  = c-list row (clistOffset; valid range 0–255).
            // methodSelector is the 0-based index from methodConventions; +1 converts to 1-based.
            const eloadcallMethodIdx = methodSelector + 1;
            if (methodSelector < 0 || methodSelector > 126) {
                errors.push({ line: stmt.lineNum, message: `Method index ${methodSelector} for '${callMatch[2]}.${methodName}' is out of range (0–126 allowed for ELOADCALL).` });
                return;
            }
            if (clistOffset < 0 || clistOffset > 255) {
                errors.push({ line: stmt.lineNum, message: `C-list row ${clistOffset} for '${callMatch[2]}' is out of range (0–255 allowed for ELOADCALL).` });
                return;
            }
            const eloadcallImm = (eloadcallMethodIdx << 8) | clistOffset;
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: `ELOADCALL CR0, CR6[${clistOffset}], method=${eloadcallMethodIdx} -> ${callMatch[2]}.${methodName}` });
            code.push(this.encode(this.opcodes.ELOADCALL, 14, 0, 6, eloadcallImm));

            if (resultVar) {
                const dr = this._allocLocal(resultVar, locals, errors, stmt.lineNum);
                if (dr !== this.DR_ARGS_START) {
                    code.push(this.encode(this.opcodes.IADD, 14, dr, this.DR_ARGS_START, 0));
                }
            }
            return;
        }

        // var = load(CRx, n) — load capability from c-list slot n of CRx into a tracked CR local
        const loadCRAssign = text.match(/^(?:(?:var|let|const)\s+)?(\w+)\s*=\s*load\s*\(\s*(\w+)\s*,\s*(\d+)\s*\)$/);
        if (loadCRAssign) {
            const varName = loadCRAssign[1];
            const srcCR = this._parseCRFull(loadCRAssign[2]);
            const offset = parseInt(loadCRAssign[3]);
            const destCR = this._crAlloc.next++;
            this._crLocals[varName] = destCR;
            manifest.push({ src: stmt.lineNum, addr: code.length, desc: `LOAD CR${destCR}, CR${srcCR}[${offset}] (${varName})` });
            code.push(this.encode(this.opcodes.LOAD, 14, destCR, srcCR, offset & 0x7FFF));
            return;
        }

        // Private-method tail-call: [var =] privateMethodName(arg0, arg1, ...)
        // Compiles to intra-LUMP BRANCH AL (offset resolved by lump_builder.js Pass4).
        // This runs before the generic assignMatch so the call is not misinterpreted
        // as a right-hand-side expression.
        if (this._privateMethodNames && this._privateMethodNames.size > 0) {
            const privCallPat = /^(?:(?:var|let|const)\s+)?(?:(\w+)\s*=\s*)?(\w+)\s*\(\s*(.*?)\s*\)$/;
            const privCallMatch = text.match(privCallPat);
            if (privCallMatch && this._privateMethodNames.has(privCallMatch[2])) {
                const resultVar  = privCallMatch[1] || null;
                const targetName = privCallMatch[2];
                const argsStr    = privCallMatch[3];
                const argList    = argsStr ? argsStr.split(',').map(s => s.trim()).filter(Boolean) : [];
                for (let i = 0; i < argList.length; i++) {
                    const argDR  = this._resolveExpr(argList[i], code, locals, rom, errors, stmt.lineNum, method, stmt.rawLine);
                    const destDR = this.DR_ARGS_START + i;
                    if (argDR !== destDR) {
                        code.push(this.encode(this.opcodes.IADD, 14, destDR, argDR, 0));
                    }
                }
                const branchAddr = code.length;
                code.push(this.encode(this.opcodes.BRANCH, this.conditions.AL, 0, 0, 0));
                manifest.push({ src: stmt.lineNum, addr: branchAddr, desc: `BRANCH → ${targetName} (private tail-call)` });
                if (this._crossMethodRefs) {
                    this._crossMethodRefs.push({ addr: branchAddr, target: targetName });
                }
                if (resultVar) {
                    const dr = this._allocLocal(resultVar, locals, errors, stmt.lineNum);
                    if (dr !== this.DR_ARGS_START) {
                        code.push(this.encode(this.opcodes.IADD, 14, dr, this.DR_ARGS_START, 0));
                    }
                }
                return;
            }
        }

        // `const` is treated identically to `let`/`var` — locals are allocated in the
        // same DR pool and there is no immutability enforcement at the compiler level.
        // This is an intentional passthrough: the Church Machine ISA has no read-only
        // data-register concept, so enforcing const semantics would require a separate
        // write-check pass.  For now, `const` is accepted without error and the
        // programmer's intent is documented in the source only.
        const assignMatch = text.match(/^(?:(?:var|let|const)\s+)?(\w+)\s*=\s*(.+)$/);
        if (assignMatch) {
            const varName = assignMatch[1];
            const expr = assignMatch[2].trim();
            const dr = this._allocLocal(varName, locals, errors, stmt.lineNum);
            const valDR = this._resolveExpr(expr, code, locals, rom, errors, stmt.lineNum, method, stmt.rawLine);
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
            const leftDR = this._resolveExpr(ifMatch[1], code, locals, rom, errors, stmt.lineNum, method, stmt.rawLine);
            const rightDR = this._resolveExpr(ifMatch[3], code, locals, rom, errors, stmt.lineNum, method, stmt.rawLine);
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
            const leftDR = this._resolveExpr(whileMatch[1], code, locals, rom, errors, stmt.lineNum, method, stmt.rawLine);
            const rightDR = this._resolveExpr(whileMatch[3], code, locals, rom, errors, stmt.lineNum, method, stmt.rawLine);
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
            labelRefs.push({ addr: branchAddr, label: gotoMatch[1], lineNum: stmt.lineNum, rawLine: stmt.rawLine });
            manifest.push({ src: stmt.lineNum, addr: branchAddr, desc: `goto ${gotoMatch[1]}` });
            return;
        }

        if (text.match(/^halt$/i) || text.match(/^stop$/i)) {
            code.push(0);
            manifest.push({ src: stmt.lineNum, addr: code.length - 1, desc: 'HALT' });
            return;
        }

        const _firstToken = text.split(/\s+/)[0];
        errors.push({ line: stmt.lineNum, message: `Cannot compile statement: ${text}`, ...CLOOMCCompiler._tokenCols(stmt.rawLine, _firstToken) });
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
            if (method.aliasOf) {
                methods.push({ name: method.name, aliasOf: method.aliasOf, params: method.params || [], visibility: method.visibility || 'public', ...(method.sourceLines && { sourceLines: method.sourceLines }) });
                continue;
            }
            if (method.rawIsa) {
                methods.push({ name: method.name, code: method.rawIsa, params: method.params || [], visibility: method.visibility || 'public', ...(method.sourceLines && { sourceLines: method.sourceLines }) });
                manifest.push({ name: method.name, mapping: [] });
                continue;
            }
            const result = this._compileHaskellMethod(method, rom, parsed.capabilities, errors);
            if (result.errors.length > 0) {
                errors.push(...result.errors);
            } else {
                methods.push({ name: method.name, code: result.code, params: method.params || [], visibility: method.visibility || 'public', ...(method.sourceLines && { sourceLines: method.sourceLines }) });
                manifest.push({ name: method.name, mapping: result.manifest });
            }
        }

        if (errors.length === 0) {
            const _bodyIndex = new Map();
            for (const m of methods) {
                if (m.aliasOf) continue;
                const fp = m.code.join(',');
                if (_bodyIndex.has(fp)) {
                    m.aliasOf = _bodyIndex.get(fp);
                } else {
                    _bodyIndex.set(fp, m.name);
                }
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

            const absMatch = line.match(/^abstraction\s+(\w+)\s*\{/i);
            if (absMatch) {
                result.name = absMatch[1];
                i++;
                i = this._parseHaskellBody(lines, i, result, errors);
                break;
            }
            i++;
        }

        if (!result.name) {
            let _firstBadLine = '';
            for (const l of lines) {
                const t = l.trim();
                if (t && !t.startsWith('--')) { _firstBadLine = l; break; }
            }
            const _firstTok = _firstBadLine.trim().split(/\s+/)[0] || '';
            const _col = _firstTok ? CLOOMCCompiler._tokenCols(_firstBadLine, _firstTok) : {};
            errors.push({ line: 0, message: 'No abstraction declaration found. Expected: abstraction Name { ... }', ..._col });
        }
        return result;
    }

    _parseHaskellBody(lines, i, result, errors) {
        while (i < lines.length) {
            const line = lines[i].trim();
            if (!line || line.startsWith('--')) { i++; continue; }
            if (line === '}') { i++; break; }

            const capMatch = line.match(/^capabilities\s*\{/);
            if (capMatch) {
                const inlineMatch = line.match(/^capabilities\s*\{\s*(.*?)\s*\}$/);
                if (inlineMatch) {
                    if (inlineMatch[1]) {
                        for (const item of inlineMatch[1].split(',')) {
                            const cap = CLOOMCCompiler._parseCapItem(item);
                            if (cap) result.capabilities.push(cap);
                        }
                    }
                    i++;
                } else {
                    i++;
                    while (i < lines.length) {
                        const capLine = lines[i].trim();
                        if (capLine === '}') { i++; break; }
                        if (capLine && !capLine.startsWith('--')) {
                            for (const item of capLine.split(',')) {
                                const cap = CLOOMCCompiler._parseCapItem(item);
                                if (cap) result.capabilities.push(cap);
                            }
                        }
                        i++;
                    }
                }
                continue;
            }

            const visMatch = line.match(/^(public|private)\s+/);
            const visibility = visMatch ? visMatch[1] : 'public';
            const explicitVisibility = !!visMatch;
            const cleanLine = visMatch ? line.slice(visMatch[0].length) : line;

            const methodMatch = cleanLine.match(/^method\s+(\w+)\s*\(([^)]*)\)\s*=\s*(.+)$/);
            if (methodMatch) {
                const _rawLine0 = lines[i];
                const _ls0 = _rawLine0.length - _rawLine0.trimStart().length;
                const method = {
                    name: methodMatch[1],
                    params: methodMatch[2] ? methodMatch[2].split(',').map(p => p.trim()).filter(Boolean) : [],
                    expr: methodMatch[3].trim(),
                    exprOffset: _ls0 + (line.length - methodMatch[3].length),
                    startLine: i,
                    isLambda: true,
                    visibility,
                    explicitVisibility
                };
                i++;
                while (i < lines.length) {
                    const contLine = lines[i].trim();
                    if (!contLine || contLine.startsWith('--') || contLine.match(/^(?:public\s+|private\s+)?method\s+/) || contLine === '}') break;
                    method.expr += ' ' + contLine;
                    i++;
                }
                result.methods.push(method);
                continue;
            }

            const blockMethodMatch = cleanLine.match(/^method\s+(\w+)\s*\(([^)]*)\)\s*=\s*$/);
            if (blockMethodMatch) {
                const method = {
                    name: blockMethodMatch[1],
                    params: blockMethodMatch[2] ? blockMethodMatch[2].split(',').map(p => p.trim()).filter(Boolean) : [],
                    expr: '',
                    exprOffset: 0,
                    startLine: i,
                    isLambda: true,
                    visibility,
                    explicitVisibility
                };
                i++;
                while (i < lines.length) {
                    const contLine = lines[i].trim();
                    if (!contLine || contLine.startsWith('--')) { i++; continue; }
                    if (contLine.match(/^(?:public\s+|private\s+)?method\s+/) || contLine === '}') break;
                    method.expr += (method.expr ? ' ' : '') + contLine;
                    i++;
                }
                result.methods.push(method);
                continue;
            }

            i++;
        }
        for (let _mi = 0; _mi < result.methods.length; _mi++) {
            const _m = result.methods[_mi];
            const _end = _mi + 1 < result.methods.length ? result.methods[_mi + 1].startLine : i;
            _m.sourceLines = lines.slice(_m.startLine, _end).join('\n');
        }
        return i;
    }

    _parseHaskellExpr(input, errors = []) {
        const tokens = this._tokenizeHaskell(input.trim());
        if (tokens.length === 0) return { type: 'literal', value: 0 };
        return this._parseHaskellExprFromTokens(tokens, 0, errors).node;
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
                    const negStart = i;
                    let num = '-';
                    i++;
                    while (i < input.length && /\d/.test(input[i])) { num += input[i]; i++; }
                    tokens.push({ type: 'number', value: parseInt(num), pos: negStart });
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
            if (input[i] === '=' && (i + 1 >= input.length || input[i + 1] !== '=')) { tokens.push({ type: 'op', value: '=', pos: i }); i++; continue; }

            if (/\d/.test(input[i]) || (input[i] === '0' && input[i + 1] === 'x')) {
                let num = '';
                const numStart = i;
                if (input[i] === '0' && i + 1 < input.length && input[i + 1] === 'x') {
                    num = '0x';
                    i += 2;
                    while (i < input.length && /[0-9a-fA-F]/.test(input[i])) { num += input[i]; i++; }
                } else {
                    while (i < input.length && /\d/.test(input[i])) { num += input[i]; i++; }
                }
                tokens.push({ type: 'number', value: parseInt(num), pos: numStart });
                continue;
            }

            if (/[a-zA-Z_]/.test(input[i])) {
                let ident = '';
                const identStart = i;
                while (i < input.length && /[a-zA-Z0-9_.]/.test(input[i])) { ident += input[i]; i++; }
                if (ident === 'let') tokens.push({ type: 'let', pos: identStart });
                else if (ident === 'in') tokens.push({ type: 'in', pos: identStart });
                else if (ident === 'case') tokens.push({ type: 'case', pos: identStart });
                else if (ident === 'of') tokens.push({ type: 'of', pos: identStart });
                else if (ident === 'if') tokens.push({ type: 'hif', pos: identStart });
                else if (ident === 'then') tokens.push({ type: 'then', pos: identStart });
                else if (ident === 'else') tokens.push({ type: 'helse', pos: identStart });
                else if (ident === 'pure') tokens.push({ type: 'pure', pos: identStart });
                else tokens.push({ type: 'ident', value: ident, pos: identStart });
                continue;
            }

            if (input[i] === '_') { tokens.push({ type: 'ident', value: '_', pos: i, startPos: i }); i++; continue; }

            i++;
        }
        return tokens;
    }

    _parseHaskellExprFromTokens(tokens, pos, errors = []) {
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
            const body = this._parseHaskellExprFromTokens(tokens, pos, errors);
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
                        const _eqTok = tokens[pos];
                        errors.push({ line: 0, message: 'let binding uses = not ==', colStart: _eqTok.pos, colEnd: _eqTok.pos + 1 });
                    }
                    if (pos < tokens.length && ((tokens[pos].type === 'op' && tokens[pos].value === '==') || (tokens[pos].type === 'op' && tokens[pos].value === '='))) pos++;
                    const val = this._parseHaskellSimpleExpr(tokens, pos, errors);
                    bindings.push({ name: name, value: val.node });
                    pos = val.pos;
                } else {
                    pos++;
                }
            }
            if (pos < tokens.length && tokens[pos].type === 'in') pos++;
            const body = this._parseHaskellExprFromTokens(tokens, pos, errors);
            return { node: { type: 'let', bindings: bindings, body: body.node }, pos: body.pos };
        }

        if (t.type === 'case') {
            pos++;
            const scrut = this._parseHaskellSimpleExpr(tokens, pos, errors);
            pos = scrut.pos;
            if (pos < tokens.length && tokens[pos].type === 'of') pos++;
            const branches = [];
            while (pos < tokens.length) {
                if (tokens[pos].type === 'rparen') break;
                const pat = this._parseHaskellPattern(tokens, pos);
                pos = pat.pos;
                if (pos < tokens.length && tokens[pos].type === 'arrow') pos++;
                const body = this._parseHaskellSimpleExpr(tokens, pos, errors);
                branches.push({ pattern: pat.node, body: body.node });
                pos = body.pos;
                if (pos < tokens.length && tokens[pos].type === 'comma') pos++;
            }
            return { node: { type: 'case', scrutinee: scrut.node, branches: branches }, pos: pos };
        }

        if (t.type === 'hif') {
            pos++;
            const cond = this._parseHaskellSimpleExpr(tokens, pos, errors);
            pos = cond.pos;
            if (pos < tokens.length && tokens[pos].type === 'then') pos++;
            const thenExpr = this._parseHaskellSimpleExpr(tokens, pos, errors);
            pos = thenExpr.pos;
            if (pos < tokens.length && tokens[pos].type === 'helse') pos++;
            const elseExpr = this._parseHaskellExprFromTokens(tokens, pos, errors);
            return { node: { type: 'ifExpr', cond: cond.node, thenBranch: thenExpr.node, elseBranch: elseExpr.node }, pos: elseExpr.pos };
        }

        if (t.type === 'pure') {
            pos++;
            const val = this._parseHaskellSimpleExpr(tokens, pos, errors);
            return { node: { type: 'pure', value: val.node }, pos: val.pos };
        }

        return this._parseHaskellBinOp(tokens, pos, errors);
    }

    _parseHaskellBinOp(tokens, pos, errors = []) {
        let left = this._parseHaskellApp(tokens, pos, errors);
        pos = left.pos;

        while (pos < tokens.length && tokens[pos].type === 'op') {
            const op = tokens[pos].value;
            const opPos = tokens[pos].pos;
            pos++;
            const right = this._parseHaskellApp(tokens, pos, errors);
            left = { node: { type: 'binop', op: op, opPos: opPos, left: left.node, right: right.node }, pos: right.pos };
            pos = right.pos;
        }

        return left;
    }

    _parseHaskellApp(tokens, pos, errors = []) {
        let func = this._parseHaskellAtom(tokens, pos, errors);
        pos = func.pos;

        while (pos < tokens.length) {
            const t = tokens[pos];
            if (t.type === 'number' || t.type === 'ident' || t.type === 'lparen') {
                const arg = this._parseHaskellAtom(tokens, pos, errors);
                func = { node: { type: 'app', func: func.node, arg: arg.node }, pos: arg.pos };
                pos = arg.pos;
            } else {
                break;
            }
        }

        return func;
    }

    _parseHaskellAtom(tokens, pos, errors = []) {
        if (pos >= tokens.length) return { node: { type: 'literal', value: 0 }, pos: pos };

        const t = tokens[pos];

        if (t.type === 'number') {
            return { node: { type: 'literal', value: t.value, pos: t.pos }, pos: pos + 1 };
        }

        if (t.type === 'ident') {
            return { node: { type: 'var', name: t.value, pos: t.pos }, pos: pos + 1 };
        }

        if (t.type === 'lparen') {
            pos++;
            if (pos < tokens.length && tokens[pos].type === 'rparen') {
                return { node: { type: 'literal', value: 0 }, pos: pos + 1 };
            }

            const inner = this._parseHaskellExprFromTokens(tokens, pos, errors);
            pos = inner.pos;

            if (pos < tokens.length && tokens[pos].type === 'comma') {
                pos++;
                const second = this._parseHaskellExprFromTokens(tokens, pos, errors);
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

    _parseHaskellSimpleExpr(tokens, pos, errors = []) {
        if (pos >= tokens.length) return { node: { type: 'literal', value: 0 }, pos: pos };

        const t = tokens[pos];

        if (t.type === 'lambda') {
            return this._parseHaskellExprFromTokens(tokens, pos, errors);
        }

        if (t.type === 'let') {
            return this._parseHaskellExprFromTokens(tokens, pos, errors);
        }

        if (t.type === 'hif') {
            return this._parseHaskellExprFromTokens(tokens, pos, errors);
        }

        return this._parseHaskellBinOp(tokens, pos, errors);
    }

    _compileHaskellMethod(method, rom, capNames, outerErrors) {
        const errors = [];
        const code = [];
        const manifest = [];
        const locals = {};
        let nextLocal = this.DR_LOCALS_START;

        for (let pi = 0; pi < method.params.length; pi++) {
            if (pi + this.DR_ARGS_START <= this.DR_ARGS_END) {
                locals[method.params[pi]] = pi + this.DR_ARGS_START;
            } else {
                if (nextLocal > this.DR_LOCALS_END) {
                    errors.push({ line: method.startLine, message: 'Too many parameters' });
                    return { code: [], errors, manifest: [] };
                }
                locals[method.params[pi]] = nextLocal++;
            }
        }

        const ast = this._parseHaskellExpr(method.expr, errors);
        const resultReg = this._emitHaskellExpr(ast, code, locals, rom, capNames, errors, manifest, method.startLine, method.exprOffset || 0);

        if (errors.length > 0) {
            return { code: [], errors, manifest: [] };
        }

        if (resultReg !== this.DR_ARGS_START) {
            code.push(this.encode(this.opcodes.IADD, 14, this.DR_ARGS_START, resultReg, 0));
        }
        manifest.push({ src: method.startLine, addr: code.length, desc: 'RETURN (implicit)' });
        code.push(this.encode(this.opcodes.RETURN, 14, 0, 0, 0));

        return { code, errors, manifest };
    }

    _emitHaskellExpr(node, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset = 0) {
        if (!node) return 0;

        switch (node.type) {
            case 'literal': {
                if (node.value > 2147483647 || node.value < -2147483648) {
                    const _lStart = (exprOffset || 0) + (node.pos !== undefined ? node.pos : 0);
                    const _lText = String(node.value);
                    errors.push({ line: lineNum, message: `Literal ${node.value} is out of range for a 32-bit Church Machine register (must be between -2147483648 and 2147483647)`, colStart: _lStart, colEnd: _lStart + _lText.length });
                    return 0;
                }
                const dr = this._allocTemp(locals);
                if (node.value > 2147483647 || node.value < -2147483648) {
                    errors.push({ line: lineNum, message: `Literal ${node.value} is out of range for a 32-bit Church Machine register (must be between -2147483648 and 2147483647)` });
                    return dr;
                }
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
                const _vStart = (exprOffset || 0) + (node.pos !== undefined ? node.pos : 0);
                errors.push({ line: lineNum, message: `Undefined variable: ${node.name}`, colStart: _vStart, colEnd: _vStart + node.name.length });
                return 0;
            }

            case 'lambda': {
                const lambdaLocals = { ...locals };
                for (let pi = 0; pi < node.params.length; pi++) {
                    if (pi + this.DR_ARGS_START <= this.DR_ARGS_END) {
                        lambdaLocals[node.params[pi]] = pi + this.DR_ARGS_START;
                    } else {
                        lambdaLocals[node.params[pi]] = this._allocLocal(node.params[pi], lambdaLocals, errors, lineNum);
                    }
                }

                const bodyStart = code.length;
                manifest.push({ src: lineNum, addr: bodyStart, desc: `lambda \\${node.params.join(' ')} -> ...` });

                const resultReg = this._emitHaskellExpr(node.body, code, lambdaLocals, rom, capNames, errors, manifest, lineNum, exprOffset);

                if (resultReg !== this.DR_ARGS_START) {
                    code.push(this.encode(this.opcodes.IADD, 14, this.DR_ARGS_START, resultReg, 0));
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
                        const argReg = this._emitHaskellExpr(node.arg, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
                        if (argReg !== this.DR_ARGS_START) {
                            code.push(this.encode(this.opcodes.IADD, 14, this.DR_ARGS_START, argReg, 0));
                        }
                        manifest.push({ src: lineNum, addr: code.length, desc: `LOAD CR0, [CR6 + ${capIdx}] (${parts[0]})` });
                        code.push(this.encode(this.opcodes.LOAD, 14, 0, 6, capIdx));
                        manifest.push({ src: lineNum, addr: code.length, desc: `CALL CR0 -> ${node.func.name}` });
                        code.push(this.encode(this.opcodes.CALL, 14, 0, 0, 0));
                        const dr = this._allocTemp(locals);
                        code.push(this.encode(this.opcodes.IADD, 14, dr, this.DR_ARGS_START, 0));
                        return dr;
                    }
                }

                if (node.func.type === 'var' && node.func.name === 'succ') {
                    const argReg = this._emitHaskellExpr(node.arg, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
                    const dr = this._allocTemp(locals);
                    manifest.push({ src: lineNum, addr: code.length, desc: 'succ (Church successor)' });
                    code.push(this.encode(this.opcodes.IADD, 14, dr, argReg, 1));
                    return dr;
                }

                if (node.func.type === 'var' && node.func.name === 'pred') {
                    const argReg = this._emitHaskellExpr(node.arg, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
                    const dr = this._allocTemp(locals);
                    manifest.push({ src: lineNum, addr: code.length, desc: 'pred (Church predecessor)' });
                    code.push(this.encode(this.opcodes.ISUB, 14, dr, argReg, 1));
                    return dr;
                }

                if (node.func.type === 'var' && node.func.name === 'isZero') {
                    const argReg = this._emitHaskellExpr(node.arg, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
                    const dr = this._allocTemp(locals);
                    manifest.push({ src: lineNum, addr: code.length, desc: 'isZero check' });
                    code.push(this.encode(this.opcodes.MCMP, 14, argReg, 0, 0));
                    code.push(this.encode(this.opcodes.IADD, this.conditions.EQ, dr, 0, 1));
                    code.push(this.encode(this.opcodes.IADD, this.conditions.NE, dr, 0, 0));
                    return dr;
                }

                if (node.func.type === 'var' && node.func.name === 'fst') {
                    const argReg = this._emitHaskellExpr(node.arg, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
                    const dr = this._allocTemp(locals);
                    manifest.push({ src: lineNum, addr: code.length, desc: 'fst (pair first)' });
                    code.push(this.encode(this.opcodes.SHR, 14, dr, argReg, 16));
                    return dr;
                }

                if (node.func.type === 'var' && node.func.name === 'snd') {
                    const argReg = this._emitHaskellExpr(node.arg, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
                    const dr = this._allocTemp(locals);
                    manifest.push({ src: lineNum, addr: code.length, desc: 'snd (pair second)' });
                    code.push(this.encode(this.opcodes.BFEXT, 14, dr, argReg, (0 << 5) | 16));
                    return dr;
                }

                const funcReg = this._emitHaskellExpr(node.func, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
                const argReg = this._emitHaskellExpr(node.arg, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);

                if (argReg !== this.DR_ARGS_START) {
                    code.push(this.encode(this.opcodes.IADD, 14, this.DR_ARGS_START, argReg, 0));
                }

                manifest.push({ src: lineNum, addr: code.length, desc: `CALL lambda` });
                code.push(this.encode(this.opcodes.CALL, 14, 0, 0, 0));
                const resultDR = this._allocTemp(locals);
                code.push(this.encode(this.opcodes.IADD, 14, resultDR, this.DR_ARGS_START, 0));
                return resultDR;
            }

            case 'binop': {
                const leftReg = this._emitHaskellExpr(node.left, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
                const rightReg = this._emitHaskellExpr(node.right, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
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
                        const _opStart = (exprOffset || 0) + (node.opPos !== undefined ? node.opPos : 0);
                        errors.push({ line: lineNum, message: `Unknown operator: ${node.op}`, colStart: _opStart, colEnd: _opStart + node.op.length });
                        return 0;
                }
                return dr;
            }

            case 'let': {
                const letLocals = { ...locals };
                for (const binding of node.bindings) {
                    const valReg = this._emitHaskellExpr(binding.value, code, letLocals, rom, capNames, errors, manifest, lineNum, exprOffset);
                    const dr = this._allocLocal(binding.name, letLocals, errors, lineNum);
                    if (valReg !== dr) {
                        code.push(this.encode(this.opcodes.IADD, 14, dr, valReg, 0));
                    }
                    manifest.push({ src: lineNum, addr: code.length - 1, desc: `let ${binding.name}` });
                }
                return this._emitHaskellExpr(node.body, code, letLocals, rom, capNames, errors, manifest, lineNum, exprOffset);
            }

            case 'case': {
                const scrutReg = this._emitHaskellExpr(node.scrutinee, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
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
                        const bodyReg = this._emitHaskellExpr(branch.body, code, branchLocals, rom, capNames, errors, manifest, lineNum, exprOffset);
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
                        const bodyReg = this._emitHaskellExpr(branch.body, code, branchLocals, rom, capNames, errors, manifest, lineNum, exprOffset);
                        code.push(this.encode(this.opcodes.IADD, 14, resultDR, bodyReg, 0));
                        const jumpEnd = code.length;
                        code.push(this.encode(this.opcodes.BRANCH, 14, 0, 0, 0));
                        endLabels.push(jumpEnd);

                    } else {
                        manifest.push({ src: lineNum, addr: code.length, desc: 'case _ ->' });
                        const branchLocals = { ...locals };
                        const bodyReg = this._emitHaskellExpr(branch.body, code, branchLocals, rom, capNames, errors, manifest, lineNum, exprOffset);
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
                const condReg = this._emitHaskellExpr(node.cond, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
                code.push(this.encode(this.opcodes.MCMP, 14, condReg, 0, 0));
                const skipThen = code.length;
                code.push(this.encode(this.opcodes.BRANCH, this.conditions.EQ, 0, 0, 0));
                manifest.push({ src: lineNum, addr: skipThen, desc: 'if-then-else' });

                const resultDR = this._allocTemp(locals);
                const thenReg = this._emitHaskellExpr(node.thenBranch, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
                code.push(this.encode(this.opcodes.IADD, 14, resultDR, thenReg, 0));
                const skipElse = code.length;
                code.push(this.encode(this.opcodes.BRANCH, 14, 0, 0, 0));

                code[skipThen] = (code[skipThen] & ~0x7FFF) | (code.length & 0x7FFF);
                code[skipThen] = code[skipThen] >>> 0;

                const elseReg = this._emitHaskellExpr(node.elseBranch, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
                code.push(this.encode(this.opcodes.IADD, 14, resultDR, elseReg, 0));

                code[skipElse] = (code[skipElse] & ~0x7FFF) | (code.length & 0x7FFF);
                code[skipElse] = code[skipElse] >>> 0;

                return resultDR;
            }

            case 'pair': {
                const fstReg = this._emitHaskellExpr(node.fst, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
                const sndReg = this._emitHaskellExpr(node.snd, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
                const dr = this._allocTemp(locals);
                manifest.push({ src: lineNum, addr: code.length, desc: 'pair (fst, snd)' });
                code.push(this.encode(this.opcodes.SHL, 14, dr, fstReg, 16));
                code.push(this.encode(this.opcodes.BFINS, 14, dr, sndReg, (0 << 5) | 16));
                return dr;
            }

            case 'pure': {
                return this._emitHaskellExpr(node.value, code, locals, rom, capNames, errors, manifest, lineNum, exprOffset);
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
                if (/[*\/]/.test(text) || /\b(multiply|divide|bernoulli)\s*\(/i.test(text) || /\bSlideRule\.\w+\s*\(/i.test(text) || /\bSlideRule\s*\(/i.test(text)) {
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

        if (typeof METHOD_REGISTER_CONVENTIONS !== 'undefined') {
            for (const absName of Object.keys(METHOD_REGISTER_CONVENTIONS)) {
                if (!this.methodConventions[absName]) {
                    this.methodConventions[absName] = METHOD_REGISTER_CONVENTIONS[absName];
                }
            }
        }

        const needsSlideRule = this._sourceNeedsSlideRule(parsed);
        if (needsSlideRule) {
            const alreadyDeclared = parsed.capabilities.some(c =>
                (typeof c === 'string' ? c : (c.name || '')).toUpperCase() === 'SLIDERULE');
            if (!alreadyDeclared) {
                parsed.capabilities.push({ name: 'SlideRule', rights: ['E'] });
            }
        }

        const rom = this._buildROM(parsed.capabilities, capabilities || []);
        const methods = [];
        const manifest = [];

        for (const method of parsed.methods) {
            const result = this._compileSymbolicMethod(method, rom, parsed.capabilities, errors);
            if (result.errors.length > 0) {
                errors.push(...result.errors);
            } else {
                methods.push({ name: method.name, code: result.code, params: method.params || [], visibility: method.visibility || 'public', ...(method.sourceLines && { sourceLines: method.sourceLines }) });
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

            const absMatch = line.match(/^abstraction\s+(\w+)\s*\{/i);
            if (absMatch) {
                result.name = absMatch[1];
                hasAbstraction = true;
                const _inlineAfterBrace = line.replace(/^abstraction\s+\w+\s*\{/i, '').trim();
                let _bodyLines = lines;
                if (_inlineAfterBrace) {
                    const _inlineParts = _inlineAfterBrace.endsWith('}')
                        ? [_inlineAfterBrace.slice(0, -1).trim(), '}']
                        : [_inlineAfterBrace];
                    _bodyLines = [...lines.slice(0, i + 1), ..._inlineParts, ...lines.slice(i + 1)];
                }
                i++;
                i = this._parseSymbolicBody(_bodyLines, i, result, errors);
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
                stmts.push({ line: j + 1, text: line, rawLine: lines[j] });
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
            if (line === '}') { i++; break; }

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

            const visMatch = line.match(/^(public|private)\s+/);
            const visibility = visMatch ? visMatch[1] : 'public';
            const explicitVisibility = !!visMatch;
            const cleanLine = visMatch ? line.slice(visMatch[0].length) : line;

            const methodMatch = cleanLine.match(/^method\s+(\w+)\s*(?:\(([^)]*)\))?\s*\{/);
            if (methodMatch) {
                const method = { name: methodMatch[1], params: [], body: [], startLine: i, visibility, explicitVisibility };
                if (methodMatch[2]) {
                    method.params = methodMatch[2].split(',').map(s => s.trim()).filter(Boolean);
                }
                i++;
                while (i < lines.length) {
                    const bodyLine = lines[i].trim();
                    if (bodyLine === '}') { i++; break; }
                    if (bodyLine && !bodyLine.startsWith('--') && !bodyLine.startsWith('//')) {
                        method.body.push({ line: i + 1, text: bodyLine, rawLine: lines[i] });
                    } else if (bodyLine.startsWith('--') || bodyLine.startsWith('//')) {
                        method.body.push({ line: i + 1, text: bodyLine, comment: true, rawLine: lines[i] });
                    }
                    i++;
                }
                result.methods.push(method);
                continue;
            }

            const letMatch = cleanLine.match(/^let\s+(\w+)((?:\s+\w+)*)\s*=\s*(.+)$/);
            if (letMatch) {
                const letName = letMatch[1];
                const letParams = letMatch[2].trim().split(/\s+/).filter(Boolean);
                const letExpr = letMatch[3].trim();
                const letVis = (!explicitVisibility && letName.startsWith('_')) ? 'private' : visibility;
                const syntheticMethod = {
                    name: letName,
                    params: letParams,
                    body: [{ line: i + 1, text: `return ${letExpr}`, rawLine: lines[i] }],
                    visibility: letVis,
                    explicitVisibility,
                };
                result.methods.push(syntheticMethod);
                i++;
                continue;
            }

            const _firstWord = line.split(/\s+/)[0];
            errors.push({ line: i + 1, message: `Cannot understand: "${line}"`, ...CLOOMCCompiler._tokenCols(lines[i], _firstWord) });
            i++;
        }
        for (let _mi = 0; _mi < result.methods.length; _mi++) {
            const _m = result.methods[_mi];
            if (_m.startLine === undefined) continue;
            const _end = _mi + 1 < result.methods.length ? result.methods[_mi + 1].startLine : i;
            _m.sourceLines = lines.slice(_m.startLine, _end).join('\n');
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
        let currentRawLine = '';
        let currentLineNum = 0;

        for (const param of method.params) {
            const paramIdx = method.params.indexOf(param);
            if (paramIdx + this.DR_ARGS_START <= this.DR_ARGS_END) {
                vars[param] = paramIdx + this.DR_ARGS_START;
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
            // Single-letter identifiers (traditional math variables: A, B, r …)
            // and V-register aliases (V1, V2 …) are treated as implicit inputs.
            if (name.length === 1 || /^V\d+$/.test(name)) return allocVar(name);
            errors.push({ line: currentLineNum, message: `Undefined variable '${name}' — assign it first (e.g. let ${name} = …)`, ...CLOOMCCompiler._tokenCols(currentRawLine, name) });
            return allocVar(name);
        };

        const parseExprValue = (expr) => {
            expr = expr.trim();
            if (expr === '0') return { type: 'zero' };
            const num = parseInt(expr);
            if (!isNaN(num) && Number.isInteger(num)) return { type: 'const', value: num };
            const vMatch = expr.match(/^V(\d+)$/);
            if (vMatch) return { type: 'var', name: expr };
            if (expr.match(/^[a-zA-Z_]\w*$/)) return { type: 'var', name: expr };
            return { type: 'expr', text: expr };
        };

        const emitLoadConst = (dr, value, lineNum) => {
            if (value > 2147483647 || value < -2147483648) {
                errors.push({ line: lineNum || 0, message: `Literal ${value} is out of range for a 32-bit Church Machine register (must be between -2147483648 and 2147483647)`, ...CLOOMCCompiler._tokenCols(currentRawLine, String(value)) });
                return;
            }
            if (value < 0) {
                const absVal = (-value) >>> 0;
                if (absVal >= 0x4000) {
                    const low  = absVal & 0x3FFF;
                    const mid  = (absVal >>> 14) & 0x3FFF;
                    const high = (absVal >>> 28) & 0xF;
                    const t2   = (dr === this.DR_TEMP_START) ? this.DR_TEMP_START + 1 : this.DR_TEMP_START;
                    code.push(this.encode(this.opcodes.IADD, 14, dr, 0, low | 0x4000));
                    manifest.push({ line: 0, instr: `IADD DR${dr}, DR0, #${low}`, comment: `load low 14 bits of ${absVal}` });
                    if (mid > 0 || high > 0) {
                        code.push(this.encode(this.opcodes.IADD, 14, t2, 0, mid | 0x4000));
                        manifest.push({ line: 0, instr: `IADD DR${t2}, DR0, #${mid}`, comment: `load mid 14 bits of ${absVal}` });
                        code.push(this.encode(this.opcodes.SHL, 14, t2, t2, 14));
                        manifest.push({ line: 0, instr: `SHL DR${t2}, DR${t2}, #14`, comment: `shift mid bits into position` });
                        code.push(this.encode(this.opcodes.IADD, 14, dr, dr, t2));
                        manifest.push({ line: 0, instr: `IADD DR${dr}, DR${dr}, DR${t2}`, comment: `combine low+mid` });
                        if (high > 0) {
                            code.push(this.encode(this.opcodes.IADD, 14, t2, 0, high | 0x4000));
                            manifest.push({ line: 0, instr: `IADD DR${t2}, DR0, #${high}`, comment: `load top 4 bits of ${absVal}` });
                            code.push(this.encode(this.opcodes.SHL, 14, t2, t2, 28));
                            manifest.push({ line: 0, instr: `SHL DR${t2}, DR${t2}, #28`, comment: `shift top bits into position` });
                            code.push(this.encode(this.opcodes.IADD, 14, dr, dr, t2));
                            manifest.push({ line: 0, instr: `IADD DR${dr}, DR${dr}, DR${t2}`, comment: `combine with top 4 bits` });
                        }
                    }
                    code.push(this.encode(this.opcodes.ISUB, 14, dr, 0, dr));
                    manifest.push({ line: 0, instr: `ISUB DR${dr}, DR0, DR${dr}`, comment: `negate → ${value}` });
                } else {
                    code.push(this.encode(this.opcodes.IADD, 14, dr, 0, absVal | 0x4000));
                    manifest.push({ line: 0, instr: `IADD DR${dr}, DR0, #${absVal}`, comment: `load magnitude ${absVal}` });
                    code.push(this.encode(this.opcodes.ISUB, 14, dr, 0, dr));
                    manifest.push({ line: 0, instr: `ISUB DR${dr}, DR0, DR${dr}`, comment: `negate → ${value}` });
                }
            } else {
                if (value >= 0x4000) {
                    const low  = value & 0x3FFF;
                    const mid  = (value >>> 14) & 0x3FFF;
                    const high = (value >>> 28) & 0xF;
                    const t2   = (dr === this.DR_TEMP_START) ? this.DR_TEMP_START + 1 : this.DR_TEMP_START;
                    code.push(this.encode(this.opcodes.IADD, 14, dr, 0, low | 0x4000));
                    manifest.push({ line: 0, instr: `IADD DR${dr}, DR0, #${low}`, comment: `load low 14 bits of ${value}` });
                    if (mid > 0 || high > 0) {
                        code.push(this.encode(this.opcodes.IADD, 14, t2, 0, mid | 0x4000));
                        manifest.push({ line: 0, instr: `IADD DR${t2}, DR0, #${mid}`, comment: `load mid 14 bits of ${value}` });
                        code.push(this.encode(this.opcodes.SHL, 14, t2, t2, 14));
                        manifest.push({ line: 0, instr: `SHL DR${t2}, DR${t2}, #14`, comment: `shift mid bits into position` });
                        code.push(this.encode(this.opcodes.IADD, 14, dr, dr, t2));
                        manifest.push({ line: 0, instr: `IADD DR${dr}, DR${dr}, DR${t2}`, comment: `combine low+mid` });
                        if (high > 0) {
                            code.push(this.encode(this.opcodes.IADD, 14, t2, 0, high | 0x4000));
                            manifest.push({ line: 0, instr: `IADD DR${t2}, DR0, #${high}`, comment: `load top 4 bits of ${value}` });
                            code.push(this.encode(this.opcodes.SHL, 14, t2, t2, 28));
                            manifest.push({ line: 0, instr: `SHL DR${t2}, DR${t2}, #28`, comment: `shift top bits into position` });
                            code.push(this.encode(this.opcodes.IADD, 14, dr, dr, t2));
                            manifest.push({ line: 0, instr: `IADD DR${dr}, DR${dr}, DR${t2}`, comment: `combine with top 4 bits` });
                        }
                    }
                } else {
                    code.push(this.encode(this.opcodes.IADD, 14, dr, 0, value | 0x4000));
                    manifest.push({ line: 0, instr: `IADD DR${dr}, DR0, #${value}`, comment: `load constant ${value}` });
                }
            }
        };

        const slideRuleMethodIndex = { Multiply: 0, Divide: 1, Sqrt: 2, Mod: 3, Bernoulli: 12, Abs: 13, Pow: 14, Min: 15, Max: 16, GCD: 17, Factorial: 18, Log2: 19, Atan2: 20, Signum: 21 };

        const emitExpr = (expr, dstDR, lineNum) => {
            expr = expr.trim();

            expr = expr.replace(/×/g, '*').replace(/÷/g, '/');

            const slideRuleMatch = expr.match(/^SlideRule\.(\w+)\s*\(\s*(.+)\s*\)$/);
            if (slideRuleMatch) {
                const srMethod = slideRuleMatch[1];
                const srArgStr = slideRuleMatch[2];
                const srMethodKey = srMethod.charAt(0).toUpperCase() + srMethod.slice(1);
                if (slideRuleMethodIndex[srMethodKey] === undefined) {
                    errors.push({ line: lineNum, message: `Unknown SlideRule method: ${srMethod}. Available: ${Object.keys(slideRuleMethodIndex).join(', ')}`, ...CLOOMCCompiler._tokenCols(currentRawLine, srMethod) });
                    return dstDR;
                }
                    const srNaturalOps = { Multiply: '*', Divide: '/', Add: '+', Subtract: '-' };
                    let srArgs = srArgStr.split(/\s*,\s*/);
                    if (srArgs.length === 1 && srNaturalOps[srMethodKey]) {
                        const natOpChar = srNaturalOps[srMethodKey];
                        const opIdx = srArgStr.indexOf(natOpChar);
                        if (opIdx > 0) {
                            srArgs = [srArgStr.slice(0, opIdx).trim(), srArgStr.slice(opIdx + 1).trim()];
                        }
                    }
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

            const anyAbsCallMatch = expr.match(/^([A-Za-z]\w*)\.(\w+)\s*\(\s*(.*?)\s*\)$/);
            if (anyAbsCallMatch) {
                const absName = anyAbsCallMatch[1];
                const mName   = anyAbsCallMatch[2];
                const argsStr = anyAbsCallMatch[3];
                const convEntry = this.methodConventions[absName] || this.methodConventions[absName.toUpperCase()];
                if (!convEntry) {
                    errors.push({ line: lineNum, message: `No method conventions registered for "${absName}". Is it declared in capabilities {}?`, ...CLOOMCCompiler._tokenCols(currentRawLine, absName) });
                    return dstDR;
                }
                const methodEntry = convEntry[mName];
                if (methodEntry === undefined) {
                    const known = Object.keys(convEntry).join(', ');
                    errors.push({ line: lineNum, message: `Unknown method "${mName}" on "${absName}". Known: ${known}`, ...CLOOMCCompiler._tokenCols(currentRawLine, mName) });
                    return dstDR;
                }
                const methodIdx = typeof methodEntry === 'object' ? (methodEntry.index != null ? methodEntry.index : 0) : methodEntry;
                const clistSlot = rom[absName.toUpperCase()];
                if (clistSlot === undefined) {
                    errors.push({ line: lineNum, message: `"${absName}" is not in the c-list — add it to capabilities {}.`, ...CLOOMCCompiler._tokenCols(currentRawLine, absName) });
                    return dstDR;
                }
                const inputSpec = (typeof methodEntry === 'object' && methodEntry.input) ? methodEntry.input : '';
                const drSlots = []; const crSlots = [];
                const drRe2 = /\bDR(\d+)/g; const crRe2 = /\bCR(\d+)/g;
                let dm2; while ((dm2 = drRe2.exec(inputSpec)) !== null) drSlots.push(parseInt(dm2[1]));
                let cm2; while ((cm2 = crRe2.exec(inputSpec)) !== null) crSlots.push(parseInt(cm2[1]));
                const anyNaturalOps = { Multiply: '*', Divide: '/', Add: '+', Subtract: '-' };
                let resolvedArgs = argsStr ? argsStr.split(/\s*,\s*/).filter(Boolean) : [];
                if (resolvedArgs.length === 1 && anyNaturalOps[mName]) {
                    const natOp = anyNaturalOps[mName];
                    const opIdx = argsStr.indexOf(natOp);
                    if (opIdx > 0) resolvedArgs = [argsStr.slice(0, opIdx).trim(), argsStr.slice(opIdx + 1).trim()];
                }
                let drArgIdx = 0, crArgIdx = 0;
                for (let ai = 0; ai < resolvedArgs.length; ai++) {
                    const arg = resolvedArgs[ai];
                    const capSlot = rom[arg.toUpperCase()];
                    if (capSlot !== undefined && crSlots.length > crArgIdx) {
                        const targetCR = crSlots[crArgIdx++];
                        code.push(this.encode(this.opcodes.LOAD, 14, targetCR, 6, capSlot));
                        manifest.push({ line: lineNum, instr: `LOAD CR${targetCR}, CR6, ${capSlot}`, comment: `load ${arg} capability` });
                    } else {
                        const targetDR = drSlots.length > drArgIdx ? drSlots[drArgIdx] : (1 + drArgIdx);
                        drArgIdx++;
                        emitExpr(arg, targetDR, lineNum);
                    }
                }
                const eloadImm = ((methodIdx + 1) << 8) | (clistSlot & 0xFF);
                code.push(this.encode(this.opcodes.ELOADCALL, 14, 0, 6, eloadImm));
                manifest.push({ line: lineNum, instr: `ELOADCALL CR0, CR6[${clistSlot}], method=${methodIdx + 1}`, comment: `${absName}.${mName}(${argsStr}) → DR1` });
                const resultDR = this.DR_ARGS_START;
                if (dstDR !== resultDR) {
                    code.push(this.encode(this.opcodes.IADD, 14, dstDR, resultDR, 0));
                    manifest.push({ line: lineNum, instr: `IADD DR${dstDR}, DR${resultDR}, DR0`, comment: `result → DR${dstDR}` });
                }
                return dstDR;
            }

            const inferCallMatch = expr.match(/^([A-Z][A-Za-z0-9_]*)\s*\(\s*(.+)\s*\)$/);
            if (inferCallMatch) {
                const absName = inferCallMatch[1];
                const innerExpr = inferCallMatch[2].trim();
                const isKnownAbs = absName === 'SlideRule' || !!this.methodConventions[absName];
                if (isKnownAbs) {
                    const opMethodMap = [['*', 'Multiply'], ['/', 'Divide'], ['+', 'Add'], ['-', 'Subtract']];
                    let routed = false;
                    for (const [op, method] of opMethodMap) {
                        const opIdx = innerExpr.indexOf(op);
                        if (opIdx > 0) {
                            const left  = innerExpr.slice(0, opIdx).trim();
                            const right = innerExpr.slice(opIdx + 1).trim();
                            return emitExpr(`${absName}.${method}(${left}, ${right})`, dstDR, lineNum);
                        }
                    }
                    if (!routed) {
                        errors.push({ line: lineNum, message: `${absName}(${innerExpr}): cannot infer method — no operator found. Use ${absName}.Sqrt(${innerExpr}) or similar.`, ...CLOOMCCompiler._tokenCols(currentRawLine, absName) });
                        return dstDR;
                    }
                }
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
                emitLoadConst(preferDR, val.value, lineNum);
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
            currentLineNum = lineNum;
            currentRawLine = stmt.rawLine || stmt.text || '';
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
                    errors.push({ line: lineNum, message: `'end' without matching 'repeat'`, ...CLOOMCCompiler._tokenCols(currentRawLine, text.match(/^end$/i)[0]) });
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

            if (text.match(/^[A-Za-z]\w*\.\w+\s*\(/)) {
                emitExpr(text, this.DR_ARGS_START, lineNum);
                continue;
            }

            errors.push({ line: lineNum, message: `Cannot parse symbolic statement: ${text}`, ...CLOOMCCompiler._tokenCols(currentRawLine, text.split(/\s+/)[0]) });
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
            if (t.match(/^(while|repeat while|loop while)\s+.+\s+(is|equals|is equal to|is greater than|is less than|is not)\s+/)) englishScore++;
            if (t.match(/^(end while|end loop)$/)) englishScore++;
            if (t.match(/^(repeat|recurse|recall|call self|call again)\s+(with\s+)?/)) englishScore++;
            if (t.match(/^(apply lambda|lambda repeat|lambda recurse|lambda self)\s+(with\s+)?/)) englishScore++;
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

        // Expose private method names to _compileStatement so calls to same-abstraction
        // private methods compile to intra-LUMP BRANCH instructions rather than
        // ELOADCALL (which would fault with PRIVATE_METHOD at runtime).
        this._privateMethodNames = new Set(
            parsed.methods
                .filter(m => (m.visibility === 'private') && !m.aliasOf && !m.rawIsa)
                .map(m => m.name)
        );

        for (const method of parsed.methods) {
            if (method.aliasOf) {
                methods.push({ name: method.name, aliasOf: method.aliasOf, params: method.params || [], visibility: method.visibility || 'public' });
                continue;
            }
            if (method.rawIsa) {
                methods.push({ name: method.name, code: method.rawIsa, params: method.params || [], visibility: method.visibility || 'public', ...(method.sourceLines && { sourceLines: method.sourceLines }) });
                manifest.push({ name: method.name, mapping: [] });
                continue;
            }
            const result = this._compileMethod(method, rom, parsed.capabilities);
            if (result.errors.length > 0) {
                errors.push(...result.errors);
            } else {
                methods.push({ name: method.name, code: result.code, params: method.params || [], visibility: method.visibility || 'public', crossMethodRefs: result.crossMethodRefs, ...(method.sourceLines && { sourceLines: method.sourceLines }) });
                manifest.push({ name: method.name, mapping: result.manifest });
            }
        }

        this._privateMethodNames = null;

        if (errors.length === 0) {
            const _bodyIndex = new Map();
            for (const m of methods) {
                if (m.aliasOf) continue;
                const fp = m.code.join(',');
                if (_bodyIndex.has(fp)) {
                    m.aliasOf = _bodyIndex.get(fp);
                } else {
                    _bodyIndex.set(fp, m.name);
                }
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

            const methodMatch = lo.match(/^(?:add|define|create)\s+(?:an?\s+)?(?:(public|private)\s+)?method\s+(?:called|named)\s+(\w+)/);
            if (methodMatch) {
                if (currentMethod) result.methods.push(currentMethod);
                const name = t.match(/(?:called|named)\s+(\w+)/i)[1];
                const visibility = methodMatch[1] || 'public';
                const explicitVisibility = !!methodMatch[1];
                currentMethod = { name: name, params: [], body: [], startLine: i, visibility, explicitVisibility };

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
                currentMethod.body.push({ text: stmt, lineNum: i, rawLine: raw });
            } else {
                const _firstWord = t.split(/\s+/)[0];
                errors.push({ line: i + 1, message: `Cannot understand: "${t}"`, ...CLOOMCCompiler._tokenCols(raw, _firstWord) });
            }
        }

        if (currentMethod) result.methods.push(currentMethod);

        // Assign sourceLines: raw source text from each method's start to the next method's start
        for (let _mi = 0; _mi < result.methods.length; _mi++) {
            const _m = result.methods[_mi];
            const _end = _mi + 1 < result.methods.length ? result.methods[_mi + 1].startLine : lines.length;
            _m.sourceLines = lines.slice(_m.startLine, _end).join('\n');
        }

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

            const blockVisMatch = t.match(/^(public|private)\s+(\w+)\s*\(([^)]*)\)\s*:?\s*$/);
            const methodMatch = blockVisMatch ? null : t.match(/^(\w+)\s*\(([^)]*)\)\s*:?\s*$/);
            if (blockVisMatch) {
                if (currentMethod) result.methods.push(currentMethod);
                const visibility = blockVisMatch[1];
                const name = blockVisMatch[2];
                const params = blockVisMatch[3].split(',').map(s => s.trim()).filter(Boolean);
                currentMethod = { name, params, body: [], startLine: i, visibility, explicitVisibility: true };
                continue;
            }
            if (methodMatch) {
                if (currentMethod) result.methods.push(currentMethod);
                const name = methodMatch[1];
                const params = methodMatch[2].split(',').map(s => s.trim()).filter(Boolean);
                currentMethod = { name, params, body: [], startLine: i, visibility: 'public', explicitVisibility: false };
                continue;
            }

            if (!currentMethod) continue;

            const stmts = this._translateEnglishBlockStatement(t, i);
            if (stmts) {
                for (const s of stmts) {
                    currentMethod.body.push({ text: s, lineNum: i, rawLine: lines[i] });
                }
            } else {
                const _firstWord = t.split(/\s+/)[0];
                errors.push({ line: i + 1, message: `Cannot understand: "${t}"`, ...CLOOMCCompiler._tokenCols(lines[i], _firstWord) });
            }
        }

        if (currentMethod) result.methods.push(currentMethod);

        // Assign sourceLines: raw source text from each method's start to the next method's start
        for (let _mi = 0; _mi < result.methods.length; _mi++) {
            const _m = result.methods[_mi];
            const _end = _mi + 1 < result.methods.length ? result.methods[_mi + 1].startLine : lines.length;
            _m.sourceLines = lines.slice(_m.startLine, _end).join('\n');
        }

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

        const returnMatch = text.match(/^(?:return|give back|send back)\s+(?:the\s+)?(.+)/i);
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

        const returnMatch = text.match(/^(?:return|give back|send back)\s+(?:the\s+)?(.+)/i);
        if (returnMatch) {
            const val = this._translateEnglishExpr(returnMatch[1]);
            return `return(${val})`;
        }

        const resultCallMatch = lo.match(/^(?:set|store|put)\s+(\w+)\s+(?:to|as)\s+(?:the\s+)?(?:result of\s+)?(?:call(?:ing)?)\s+(\w+)\.(\w+)\s*(?:\(([^)]*)\)|with\s+(.+))?/);
        if (resultCallMatch) {
            const varName = resultCallMatch[1];
            const _rcOrig = text.match(/^(?:set|store|put)\s+(\w+)\s+(?:to|as)\s+(?:the\s+)?(?:result of\s+)?(?:call(?:ing)?)\s+(\w+)\.(\w+)\s*(?:\(([^)]*)\)|with\s+(.+))?/i);
            const abs = _rcOrig ? _rcOrig[2] : resultCallMatch[2];
            const meth = _rcOrig ? _rcOrig[3] : resultCallMatch[3];
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
            const _cmOrig = text.match(/^(?:call|run|execute|invoke)\s+(\w+)\.(\w+)/i);
            const abs = _cmOrig ? _cmOrig[1] : callMatch[1];
            const meth = _cmOrig ? _cmOrig[2] : callMatch[2];
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

        const whileMatch = lo.match(/^(?:while|repeat while|loop while)\s+(\w+)\s+(is greater than|is less than|is equal to|is not|equals|is|==|!=|<|>|<=|>=)\s+(\w+)/);
        if (whileMatch) {
            let op;
            switch (whileMatch[2]) {
                case 'is equal to': case 'equals': case 'is': case '==': op = '=='; break;
                case 'is not': case '!=': op = '!='; break;
                case 'is greater than': case '>': op = '>'; break;
                case 'is less than': case '<': op = '<'; break;
                case '>=': op = '>='; break;
                case '<=': op = '<='; break;
                default: op = '=='; break;
            }
            return `while (${whileMatch[1]} ${op} ${whileMatch[3]}) {`;
        }

        if (lo === 'end while' || lo === 'end loop') {
            return '}';
        }

        const repeatMatch = lo.match(/^(?:repeat|recurse|recall|call self|call again)\s+(?:with\s+)?(.+)/);
        if (repeatMatch) {
            const argsExpr = this._translateEnglishExpr(repeatMatch[1]);
            const args = argsExpr.split(',').map(s => s.trim()).join(', ');
            return `recall(${args})`;
        }

        const lambdaRepeatMatch = lo.match(/^(?:apply lambda|lambda repeat|lambda recurse|lambda self)\s+(?:with\s+)?(.+)/);
        if (lambdaRepeatMatch) {
            const argsExpr = this._translateEnglishExpr(lambdaRepeatMatch[1]);
            const args = argsExpr.split(',').map(s => s.trim()).join(', ');
            return `relambda(${args})`;
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
        e = e.replace(/\b(\w+)\s+shifted\s+right\s+(?:signed|arithmetically)\s+(?:by\s+)?(\d+)\b/gi, '$1 >>s $2');
        e = e.replace(/\b(\w+)\s+shifted\s+right\s+(?:by\s+)?(\d+)\b/gi, '$1 >> $2');

        return e.trim();
    }

    _detectPetName(source) {
        const stripped = source.replace(/;[^\n]*/g, '').replace(/\/\/[^\n]*/g, '').replace(/--[^\n]*/g, '');
        if (/[;{}]/.test(stripped)) return false;
        if (/\b(var|let|const|function|return|if|else|for|while|switch|class|import|export|require|console)\b/.test(stripped)) return false;
        if (/===|!==|&&|\|\||=>/.test(stripped)) return false;
        if (this._detectEnglish(source)) return false;
        if (/^\s*abstraction\s+\w+/m.test(source)) return false;
        if (/^\s*method\s+\w+/m.test(source)) return false;
        if (/^\s*(?:create|define|make)\s+(?:an?\s+)?abstraction/im.test(source)) return false;

        const builtFuncNames = CLOOMCCompiler._getPetNameFuncNames();
        const funcPattern = builtFuncNames.length > 0
            ? new RegExp('^\\s*(?:[A-Za-z_]\\w*\\s*=\\s*)?(?:' + builtFuncNames.join('|') + ')\\s*\\(', 'i')
            : /^\s*(?:[A-Za-z_]\w*\s*=\s*)?(?:Sqrt|GCD|Factorial|Log2|Abs|Min|Max|Pow|Sin|Cos|Tan)\s*\(/i;

        const constNames = CLOOMCCompiler._getPetNameConstNames();
        const constPattern = constNames.length > 0
            ? new RegExp('^\\s*[A-Za-z_]\\w*\\s*=\\s*(?:' + constNames.join('|') + ')\\s*$', 'i')
            : null;

        const lines = source.split('\n');
        let petNameScore = 0;
        const asmMnemonics = /^\s*(LOAD|SAVE|CALL|RETURN|CHANGE|SWITCH|TPERM|LAMBDA|ELOADCALL|XLOADLAMBDA|DREAD|DWRITE|BFEXT|BFINS|MCMP|IADD|ISUB|BRANCH\w*|SHL|SHR|ASR|HALT|NOP)\b/i;
        const operatorPattern = /^\s*[A-Za-z_]\w*\s*=\s*[A-Za-z_\d]\S*\s*[\+\-\*\/%\^]\s*/;
        const assignPattern = /^\s*[A-Za-z_]\w*\s*=\s*.+/;
        const petLoadPattern = /^\s*LOAD\s+([A-Za-z_]\w*(?:\[\d+\])?)\s*$/i;
        let exprLines = 0;
        for (const line of lines) {
            const t = line.trim();
            if (!t || t.startsWith(';') || t.startsWith('//') || t.startsWith('--')) continue;
            const petLoad = t.match(petLoadPattern);
            if (petLoad && !/^(CR\d+|DR\d+)$/i.test(petLoad[1])) { petNameScore += 3; exprLines++; continue; }
            if (asmMnemonics.test(t)) continue;
            if (funcPattern.test(t)) { petNameScore += 3; exprLines++; continue; }
            if (constPattern && constPattern.test(t)) { petNameScore += 2; exprLines++; continue; }
            if (operatorPattern.test(t)) { petNameScore += 2; exprLines++; continue; }
            if (assignPattern.test(t)) { petNameScore += 2; exprLines++; continue; }
        }
        return petNameScore >= 2 && exprLines >= 1;
    }

    compilePetName(source, capabilities) {
        const errors = [];
        const code = [];
        const codeLineNums = [];
        const manifest = [];
        const locals = {};
        const crLocals = {};
        const lines = source.split('\n');
        const neededCaps = {};
        let nextCapIndex = 0;
        let allocFailed = false;
        let crAllocFailed = false;

        const RESERVED_CRS = new Set([0, 6, 12, 13, 14, 15]);

        const requireCap = (nsSlot, name) => {
            if (!neededCaps[nsSlot]) {
                neededCaps[nsSlot] = { capIndex: nextCapIndex++, nsSlot, name };
            }
            return neededCaps[nsSlot].capIndex + 1;
        };

        const allocCR = (name, lineNum) => {
            if (crLocals[name] !== undefined) return crLocals[name];
            const usedCRs = new Set(Object.values(crLocals));
            for (let cr = 1; cr <= 11; cr++) {
                if (!RESERVED_CRS.has(cr) && !usedCRs.has(cr)) {
                    crLocals[name] = cr;
                    return cr;
                }
            }
            if (!crAllocFailed) {
                crAllocFailed = true;
                errors.push({ line: lineNum !== undefined ? lineNum : 0, message: `Too many capabilities loaded — no free CR available (CR0, CR6, CR12–CR15 are reserved)` });
            }
            return 1;
        };

        const tables = CLOOMCCompiler._buildPetNameTables();
        const OP_TABLE = tables.opTable;
        const FUNC_TABLE = tables.funcTable;
        const FUNC_NAMES = tables.funcNames;

        const CAP_NAMES = {};
        for (const [fname, fentry] of Object.entries(FUNC_TABLE)) {
            const absLower = fentry.abs.toLowerCase();
            if (!CAP_NAMES[absLower]) {
                CAP_NAMES[absLower] = fentry;
            }
        }

        const asmMnemonics = /^\s*(LOAD|SAVE|CALL|RETURN|CHANGE|SWITCH|TPERM|LAMBDA|ELOADCALL|XLOADLAMBDA|DREAD|DWRITE|BFEXT|BFINS|MCMP|IADD|ISUB|BRANCH\w*|SHL|SHR|ASR|HALT|NOP)\b/i;

        const PETNAME_DR_START = 1;
        const PETNAME_DR_END = 11;
        const PETNAME_SAFE_START = 4;

        const allocPetReg = (name, lineNum) => {
            if (locals[name] !== undefined) return locals[name];
            for (let r = PETNAME_SAFE_START; r <= PETNAME_DR_END; r++) {
                if (!Object.values(locals).includes(r)) {
                    locals[name] = r;
                    return r;
                }
            }
            for (let r = PETNAME_DR_START; r < PETNAME_SAFE_START; r++) {
                if (!Object.values(locals).includes(r)) {
                    locals[name] = r;
                    return r;
                }
            }
            if (!allocFailed) {
                allocFailed = true;
                errors.push({ line: lineNum !== undefined ? lineNum : 0, message: `Too many variables — only ${PETNAME_DR_END - PETNAME_DR_START + 1} pet-name registers available (DR${PETNAME_DR_START}–DR${PETNAME_DR_END})` });
            }
            return PETNAME_SAFE_START;
        };

        const freeTempReg = (name) => {
            if (name && name.startsWith('__') && locals[name] !== undefined) {
                delete locals[name];
            }
        };

        const emitLoadImm = (dr, val, lineNum) => {
            const isNeg = val < 0;
            if (isNeg) val = (-val) >>> 0;
            if (val === 0) {
                code.push(this.encode(this.opcodes.IADD, 14, dr, 0, 0));
            } else if (val <= 0x3FFF) {
                code.push(this.encode(this.opcodes.IADD, 14, dr, 0, val | 0x4000));
            } else {
                const low = val & 0x3FFF;
                const mid = (val >>> 14) & 0x3FFF;
                const high = (val >>> 28) & 0xF;
                code.push(this.encode(this.opcodes.IADD, 14, dr, 0, low | 0x4000));
                if (mid > 0 || high > 0) {
                    const tmpName = '__shl_' + code.length;
                    const t2 = allocPetReg(tmpName, lineNum);
                    code.push(this.encode(this.opcodes.IADD, 14, t2, 0, mid | 0x4000));
                    code.push(this.encode(this.opcodes.SHL, 14, t2, t2, 14));
                    code.push(this.encode(this.opcodes.IADD, 14, dr, dr, t2));
                    if (high > 0) {
                        code.push(this.encode(this.opcodes.IADD, 14, t2, 0, high | 0x4000));
                        code.push(this.encode(this.opcodes.SHL, 14, t2, t2, 28));
                        code.push(this.encode(this.opcodes.IADD, 14, dr, dr, t2));
                    }
                    freeTempReg(tmpName);
                }
            }
            if (isNeg) {
                code.push(this.encode(this.opcodes.ISUB, 14, dr, 0, dr));
            }
        };

        const protectCallRegs = (lineNum) => {
            for (const [name, dr] of Object.entries(locals)) {
                if (dr >= 1 && dr <= 3 && !name.startsWith('__')) {
                    let newDR = -1;
                    for (let r = PETNAME_SAFE_START; r <= PETNAME_DR_END; r++) {
                        if (!Object.values(locals).includes(r)) { newDR = r; break; }
                    }
                    if (newDR >= 0) {
                        code.push(this.encode(this.opcodes.IADD, 14, newDR, dr, 0));
                        locals[name] = newDR;
                    }
                }
            }
        };

        const loadedCRs = {};
        const emitAbsCall = (nsSlot, absName, methodIndex, lineNum) => {
            const clistOffset = requireCap(nsSlot, absName);
            const cr = allocCR(absName, lineNum);
            if (!loadedCRs[absName]) {
                manifest.push({ src: lineNum, addr: code.length, desc: `LOAD CR${cr}, CR6, #${clistOffset}  (${absName} GT from c-list)` });
                code.push(this.encode(this.opcodes.LOAD, 14, cr, 6, clistOffset));
                loadedCRs[absName] = true;
            }
            const mName = this._resolveMethodName(absName, methodIndex);
            manifest.push({ src: lineNum, addr: code.length, desc: `CALL ${absName}.${mName || methodIndex} via CR${cr}, imm=${methodIndex + 1}` });
            code.push(this.encode(this.opcodes.CALL, 14, cr, 0, methodIndex + 1));
        };

        const emitOpCall = (opEntry, leftDR, rightDR, lineNum) => {
            protectCallRegs(lineNum);
            if (leftDR !== 1) code.push(this.encode(this.opcodes.IADD, 14, 1, leftDR, 0));
            if (rightDR !== 2) code.push(this.encode(this.opcodes.IADD, 14, 2, rightDR, 0));
            emitAbsCall(opEntry.nsSlot, opEntry.abs, opEntry.methodIndex, lineNum);
        };

        const emitFuncCall = (func, argDRs, lineNum) => {
            protectCallRegs(lineNum);
            if (argDRs[0] !== undefined && argDRs[0] !== 1) {
                code.push(this.encode(this.opcodes.IADD, 14, 1, argDRs[0], 0));
            }
            if (func.args >= 2 && argDRs[1] !== undefined && argDRs[1] !== 2) {
                code.push(this.encode(this.opcodes.IADD, 14, 2, argDRs[1], 0));
            }
            emitAbsCall(func.nsSlot, func.abs, func.methodIndex, lineNum);
        };

        let __tmpCounter = 0;
        const saveResult = (lineNum, outputDR) => {
            const srcDR = outputDR || 1;
            const tmpName = '__res_' + (__tmpCounter++);
            const dr = allocPetReg(tmpName, lineNum);
            if (dr !== srcDR) {
                code.push(this.encode(this.opcodes.IADD, 14, dr, srcDR, 0));
            }
            return dr;
        };

        const findTempKey = (dr) => {
            return Object.keys(locals).find(k => locals[k] === dr && k.startsWith('__')) || '';
        };

        const compileExpr = (expr, lineNum) => {
            expr = expr.trim();
            expr = this._insertImplicitMul(expr, FUNC_TABLE);

            const numMatch = expr.match(/^-?(0x[0-9a-fA-F]+|\d+)$/);
            if (numMatch) {
                const tmpName = '__val_' + (__tmpCounter++);
                const dr = allocPetReg(tmpName, lineNum);
                emitLoadImm(dr, parseInt(expr), lineNum);
                return dr;
            }

            if (/^[A-Za-z_]\w*$/.test(expr)) {
                const reg = locals[expr];
                if (reg !== undefined) return reg;
                const constFunc = FUNC_TABLE[expr.toLowerCase()];
                if (constFunc && constFunc.args === 0) {
                    protectCallRegs(lineNum);
                    emitAbsCall(constFunc.nsSlot, constFunc.abs, constFunc.methodIndex, lineNum);
                    return saveResult(lineNum, constFunc.outputDR);
                }
                errors.push({ line: lineNum, message: `Unknown variable '${expr}' — assign it first (e.g. ${expr} = 5)`, ...CLOOMCCompiler._tokenCols(lines[lineNum], expr) });
                return 0;
            }

            const funcMatch = expr.match(/^([A-Za-z_]\w*)\s*\((.*)\)$/);
            if (funcMatch) {
                const funcName = funcMatch[1].toLowerCase();
                const func = FUNC_TABLE[funcName];
                if (!func) {
                    errors.push({ line: lineNum, message: `Unknown function '${funcMatch[1]}' — available: ${FUNC_NAMES}`, ...CLOOMCCompiler._tokenCols(lines[lineNum], funcMatch[1]) });
                    return 0;
                }
                const rawArgs = this._splitFuncArgs(funcMatch[2]);
                if (rawArgs.length < func.args) {
                    errors.push({ line: lineNum, message: `${funcMatch[1]}() expects ${func.args} argument(s), got ${rawArgs.length}`, ...CLOOMCCompiler._tokenCols(lines[lineNum], funcMatch[1]) });
                    return 0;
                }
                const argDRs = [];
                for (let ai = 0; ai < func.args; ai++) {
                    argDRs.push(compileExpr(rawArgs[ai], lineNum));
                }
                emitFuncCall(func, argDRs, lineNum);
                for (const a of argDRs) freeTempReg(findTempKey(a));
                return saveResult(lineNum, func.outputDR);
            }

            const addSubPos = this._findTopLevelOp(expr, ['+', '-']);
            if (addSubPos >= 0) {
                const op = expr[addSubPos];
                const left = expr.substring(0, addSubPos);
                const right = expr.substring(addSubPos + 1);
                const leftDR = compileExpr(left, lineNum);
                const rightDR = compileExpr(right, lineNum);
                const opEntry = OP_TABLE[op];
                manifest.push({ src: lineNum, addr: code.length, desc: `${left.trim()} ${op} ${right.trim()} via ${opEntry.abs}.${opEntry.method}` });
                emitOpCall(opEntry, leftDR, rightDR, lineNum);
                freeTempReg(findTempKey(leftDR));
                freeTempReg(findTempKey(rightDR));
                const opFunc = FUNC_TABLE[opEntry.method.toLowerCase()];
                return saveResult(lineNum, opFunc ? opFunc.outputDR : 1);
            }

            const mulDivPos = this._findTopLevelOp(expr, ['*', '/', '%']);
            if (mulDivPos >= 0) {
                const op = expr[mulDivPos];
                const left = expr.substring(0, mulDivPos);
                const right = expr.substring(mulDivPos + 1);
                const leftDR = compileExpr(left, lineNum);
                const rightDR = compileExpr(right, lineNum);
                const opEntry = OP_TABLE[op];
                manifest.push({ src: lineNum, addr: code.length, desc: `${left.trim()} ${op} ${right.trim()} via ${opEntry.abs}.${opEntry.method}` });
                emitOpCall(opEntry, leftDR, rightDR, lineNum);
                freeTempReg(findTempKey(leftDR));
                freeTempReg(findTempKey(rightDR));
                const mulFunc = FUNC_TABLE[opEntry.method.toLowerCase()];
                return saveResult(lineNum, mulFunc ? mulFunc.outputDR : 1);
            }

            const powPos = this._findTopLevelOp(expr, ['^']);
            if (powPos >= 0) {
                const left = expr.substring(0, powPos);
                const right = expr.substring(powPos + 1);
                const leftDR = compileExpr(left, lineNum);
                const rightDR = compileExpr(right, lineNum);
                const opEntry = OP_TABLE['^'];
                manifest.push({ src: lineNum, addr: code.length, desc: `${left.trim()} ^ ${right.trim()} via ${opEntry.abs}.${opEntry.method}` });
                emitOpCall(opEntry, leftDR, rightDR, lineNum);
                freeTempReg(findTempKey(leftDR));
                freeTempReg(findTempKey(rightDR));
                const powFunc = FUNC_TABLE[opEntry.method.toLowerCase()];
                return saveResult(lineNum, powFunc ? powFunc.outputDR : 1);
            }

            if (expr.startsWith('(') && expr.endsWith(')')) {
                return compileExpr(expr.substring(1, expr.length - 1), lineNum);
            }

            errors.push({ line: lineNum, message: `Cannot parse expression: "${expr}"`, ...CLOOMCCompiler._tokenCols(lines[lineNum], expr.trim().split(/\s+/)[0]) });
            return 0;
        };

        const substitutePetNames = (line) => {
            // Pass 1: compound bracket names like LED[0] → CR<n>.
            // Must run before the plain-word pass so the bracket form is matched
            // as a unit rather than "LED" and "[0]" being matched separately.
            let out = line.replace(/\b([A-Za-z_]\w*\[\d+\])/g, (match) => {
                const cr = crLocals[match];
                if (cr !== undefined) return `CR${cr}`;
                return match;
            });
            // Pass 2: plain word names.
            return out.replace(/\b([A-Za-z_]\w*)\b/g, (match) => {
                const upper = match.toUpperCase();
                if (/^(DR\d+|CR\d+)$/.test(upper)) return match;
                if (/^(LOAD|SAVE|CALL|RETURN|CHANGE|SWITCH|TPERM|LAMBDA|ELOADCALL|XLOADLAMBDA|DREAD|DWRITE|BFEXT|BFINS|MCMP|IADD|ISUB|BRANCH(EQ|NE|CS|CC|MI|PL|VS|VC|HI|LS|GE|LT|GT|LE|NV)?|SHL|SHR|ASR|HALT|NOP)$/.test(upper)) return match;
                const cr = crLocals[match];
                if (cr !== undefined) return `CR${cr}`;
                const reg = locals[match];
                if (reg !== undefined) return `DR${reg}`;
                return match;
            });
        };

        let asmBlock = [];
        let asmBlockSrcLines = [];

        const flushAsmBlock = () => {
            if (asmBlock.length === 0) return;
            const combined = asmBlock.join('\n');
            const AsmClass = typeof ChurchAssembler !== 'undefined'
                ? ChurchAssembler
                : (typeof require !== 'undefined' ? require('./assembler.js') : null);
            const asmObj = new AsmClass();
            const asmResult = asmObj.assemble(combined);
            if (asmResult.errors && asmResult.errors.length > 0) {
                for (const e of asmResult.errors) {
                    const errIdx = e.line !== undefined ? (e.line > 0 ? e.line - 1 : e.line) : 0;
                    const srcLine = asmBlockSrcLines[errIdx] || asmBlockSrcLines[0];
                    errors.push({ line: srcLine, message: e.message });
                }
            } else if (asmResult.words && asmResult.words.length > 0) {
                manifest.push({ src: asmBlockSrcLines[0], addr: code.length, desc: asmBlock[0] + (asmBlock.length > 1 ? ` (+${asmBlock.length - 1} lines)` : '') });
                for (let _wi = 0; _wi < asmResult.words.length; _wi++) {
                    code.push(asmResult.words[_wi]);
                    const _asmLn = asmResult.lineNums ? asmResult.lineNums[_wi] : null;
                    const _origIdx = (_asmLn != null && _asmLn > 0) ? _asmLn - 1 : 0;
                    const _srcLine = asmBlockSrcLines[_origIdx];
                    codeLineNums.push(_srcLine != null ? _srcLine + 1 : null);
                }
            }
            asmBlock = [];
            asmBlockSrcLines = [];
        };

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const t = raw.trim();
            if (!t || t.startsWith(';') || t.startsWith('//') || t.startsWith('--')) continue;

            const petLoadMatch = t.match(/^\s*LOAD\s+([A-Za-z_]\w*(?:\[\d+\])?)\s*$/i);
            if (petLoadMatch) {
                const petName = petLoadMatch[1];
                if (/^(CR\d+|DR\d+)$/i.test(petName)) {
                    asmBlock.push(substitutePetNames(t));
                    asmBlockSrcLines.push(i);
                    continue;
                }
                // LED<N> shorthand (canonical) or legacy LED[N] bracket form.
                // Default boot c-list slot is 8+N, but POLA may compact it to a lower
                // slot and persist the new index into ChurchAssembler._sharedNsSymbols.
                // Always prefer the shared symbol so recompiling after POLA stays correct.
                const _ledBracket = petName.match(/^LED(\d)$/i) || petName.match(/^LED\[(\d)\]$/i);
                if (_ledBracket) {
                    const _n = parseInt(_ledBracket[1], 10);
                    if (_n >= 0 && _n <= 5) {
                        flushAsmBlock();
                        const _ledKey = 'LED' + _n;
                        const _sharedNs = (typeof ChurchAssembler !== 'undefined') &&
                                          ChurchAssembler._sharedNsSymbols;
                        const _clistOffset = (_sharedNs && _sharedNs[_ledKey] !== undefined)
                            ? _sharedNs[_ledKey]
                            : (8 + _n);
                        const _cr = allocCR(petName, i);
                        crLocals[petName] = _cr;
                        manifest.push({ src: i, addr: code.length,
                            desc: `LOAD CR${_cr}, CR6, #${_clistOffset}  (${petName} Abstract GT)` });
                        code.push(this.encode(this.opcodes.LOAD, 14, _cr, 6, _clistOffset));
                        codeLineNums.push(i + 1);
                        continue;
                    }
                }
                flushAsmBlock();
                const capEntry = CAP_NAMES[petName.toLowerCase()];
                if (!capEntry) {
                    errors.push({ line: i, message: `LOAD ${petName}: "${petName}" is not a known capability in the c-list — access denied`, ...CLOOMCCompiler._tokenCols(lines[i], petName) });
                    continue;
                }
                const canonName = capEntry.abs;
                const clistOffset = requireCap(capEntry.nsSlot, canonName);
                const cr = allocCR(canonName, i);
                crLocals[petName] = cr;
                manifest.push({ src: i, addr: code.length, desc: `LOAD CR${cr}, CR6, #${clistOffset}  (${petName} GT from c-list)` });
                code.push(this.encode(this.opcodes.LOAD, 14, cr, 6, clistOffset));
                codeLineNums.push(i + 1);
                continue;
            }

            if (asmMnemonics.test(t) || /^\s*\w+:\s*(LOAD|SAVE|CALL|RETURN|CHANGE|SWITCH|TPERM|LAMBDA|ELOADCALL|XLOADLAMBDA|DREAD|DWRITE|BFEXT|BFINS|MCMP|IADD|ISUB|BRANCH\w*|SHL|SHR|ASR|HALT|NOP)?\b/i.test(t)) {
                asmBlock.push(substitutePetNames(t));
                asmBlockSrcLines.push(i);
                continue;
            }

            if (/^[A-Za-z_]\w*:$/.test(t)) {
                asmBlock.push(t);
                asmBlockSrcLines.push(i);
                continue;
            }

            flushAsmBlock();

            const bareFunc = t.match(/^([A-Za-z_]\w*)\s*\((.*)\)$/);
            if (bareFunc && !t.match(/^[A-Za-z_]\w*\s*=/)) {
                const funcName = bareFunc[1].toLowerCase();
                const func = FUNC_TABLE[funcName];
                if (func) {
                    const rawArgs = this._splitFuncArgs(bareFunc[2]);
                    if (rawArgs.length < func.args) {
                        errors.push({ line: i, message: `${bareFunc[1]}() expects ${func.args} argument(s), got ${rawArgs.length}`, ...CLOOMCCompiler._tokenCols(lines[i], bareFunc[1]) });
                        continue;
                    }
                    const argDRs = [];
                    for (let ai = 0; ai < func.args; ai++) {
                        argDRs.push(compileExpr(rawArgs[ai], i));
                    }
                    manifest.push({ src: i, addr: code.length, desc: `${bareFunc[1]}(${bareFunc[2]})` });
                    emitFuncCall(func, argDRs, i);
                    while (codeLineNums.length < code.length) codeLineNums.push(i + 1);
                    const tmpKeys = Object.keys(locals).filter(k => k.startsWith('__'));
                    for (const k of tmpKeys) delete locals[k];
                    continue;
                }
            }

            const assignMatch = t.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
            if (assignMatch) {
                const destName = assignMatch[1];
                const exprStr = assignMatch[2].trim();
                const resultDR = compileExpr(exprStr, i);
                const destDR = allocPetReg(destName, i);
                if (resultDR !== destDR) {
                    manifest.push({ src: i, addr: code.length, desc: `${destName} = ${exprStr}` });
                    code.push(this.encode(this.opcodes.IADD, 14, destDR, resultDR, 0));
                } else {
                    manifest.push({ src: i, addr: code.length - 1, desc: `${destName} = ${exprStr} (in-place)` });
                }
                while (codeLineNums.length < code.length) codeLineNums.push(i + 1);
                const tmpKeys = Object.keys(locals).filter(k => k.startsWith('__'));
                for (const k of tmpKeys) delete locals[k];
                continue;
            }

            errors.push({ line: i, message: `Cannot parse pet-name expression: "${t}"`, ...CLOOMCCompiler._tokenCols(lines[i], t.split(/\s+/)[0]) });
        }

        flushAsmBlock();

        if (code.length === 0 || (code[code.length - 1] !== 0)) {
            code.push(0);
        }
        while (codeLineNums.length < code.length) codeLineNums.push(null);

        const capsArray = Object.values(neededCaps).sort((a, b) => a.capIndex - b.capIndex);
        const drMap = {};
        for (const [name, reg] of Object.entries(locals)) {
            if (!name.startsWith('__')) drMap[reg] = name;
        }
        const crMap = {};
        for (const [name, reg] of Object.entries(crLocals)) {
            crMap[reg] = name;
        }
        const drPetNamesNumeric = {};
        for (const [reg, name] of Object.entries(drMap)) drPetNamesNumeric[reg] = name;
        const crPetNamesNumeric = {};
        for (const [reg, name] of Object.entries(crMap)) crPetNamesNumeric[reg] = name;
        const methods = [{
            name: 'run',
            code: code,
            lineNums: codeLineNums,
            pet_names: { DR: drPetNamesNumeric, CR: crPetNamesNumeric }
        }];
        return {
            methods,
            errors,
            manifest: [{ name: 'run', mapping: manifest }],
            abstractionName: 'PetNameExpression',
            capabilities: capsArray.map(c => c.name),
            _neededCaps: capsArray,
            language: 'petname',
            _petNameDR: drMap,
            _petNameCR: crMap
        };
    }

    _splitFuncArgs(argStr) {
        const args = [];
        let depth = 0;
        let current = '';
        for (let i = 0; i < argStr.length; i++) {
            const ch = argStr[i];
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
            if (ch === ',' && depth === 0) {
                args.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        if (current.trim()) args.push(current.trim());
        return args;
    }

    _resolveMethodName(absName, methodIndex) {
        const regConv = (typeof METHOD_REGISTER_CONVENTIONS !== 'undefined') ? METHOD_REGISTER_CONVENTIONS : {};
        const conv = regConv[absName];
        if (conv) {
            const entry = Object.entries(conv).find(([, v]) => v.index === methodIndex);
            if (entry) return entry[0];
        }
        const bootUploads = (typeof BOOT_UPLOADS !== 'undefined') ? BOOT_UPLOADS : [];
        for (const upload of bootUploads) {
            if (upload.abstraction === absName && upload.methods) {
                if (methodIndex < upload.methods.length) return upload.methods[methodIndex].name;
            }
        }
        return null;
    }

    _insertImplicitMul(expr, funcTable) {
        const tokens = [];
        const re = /(0x[0-9a-fA-F]+|[A-Za-z_]\w*|\d+(?:\.\d+)?(?:e[+-]?\d+)?|[+\-*/%^(),]|\S)/gi;
        let m;
        while ((m = re.exec(expr)) !== null) {
            tokens.push(m[0]);
        }
        if (tokens.length <= 1) return expr;
        let result = tokens[0];
        for (let i = 1; i < tokens.length; i++) {
            const prev = tokens[i - 1];
            const cur = tokens[i];
            const prevIsVal = /^[A-Za-z_\w]/.test(prev) || prev === ')' || /^\d/.test(prev);
            const curIsVal = /^[A-Za-z_]/.test(cur) || cur === '(' || /^\d/.test(cur);
            if (prevIsVal && curIsVal) {
                if (prev === ')' && cur === '(') {
                    result += '*';
                } else if (/^[A-Za-z_]\w*$/.test(prev) && cur === '(') {
                    // skip — this is a function call like Sqrt(x)
                } else {
                    result += '*';
                }
            }
            result += cur;
        }
        return result;
    }

    _findTopLevelOp(expr, ops) {
        let depth = 0;
        let bestPos = -1;
        for (let i = expr.length - 1; i >= 0; i--) {
            const ch = expr[i];
            if (ch === ')') depth++;
            else if (ch === '(') depth--;
            if (depth === 0 && ops.includes(ch)) {
                if (i === 0) continue;
                const prev = expr[i - 1];
                if (ch === '-' && (prev === '*' || prev === '/' || prev === '%' || prev === '+' || prev === '-' || prev === '(' || prev === ',')) continue;
                bestPos = i;
                break;
            }
        }
        return bestPos;
    }

    static _getPetNameFuncNames() {
        if (CLOOMCCompiler._cachedFuncNames) return CLOOMCCompiler._cachedFuncNames;
        const tables = CLOOMCCompiler._buildPetNameTables();
        CLOOMCCompiler._cachedFuncNames = Object.keys(tables.funcTable)
            .map(k => k.charAt(0).toUpperCase() + k.slice(1))
            .filter((v, i, a) => a.indexOf(v) === i);
        return CLOOMCCompiler._cachedFuncNames;
    }

    static _getPetNameConstNames() {
        if (CLOOMCCompiler._cachedConstNames) return CLOOMCCompiler._cachedConstNames;
        const tables = CLOOMCCompiler._buildPetNameTables();
        CLOOMCCompiler._cachedConstNames = Object.entries(tables.funcTable)
            .filter(([, v]) => v.args === 0)
            .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1))
            .filter((v, i, a) => a.indexOf(v) === i);
        return CLOOMCCompiler._cachedConstNames;
    }

    static _buildPetNameTables() {
        const opTable = {};
        const funcTable = {};
        const opMapping = { '+': 'Add', '-': 'Sub', '*': 'Multiply', '/': 'Divide', '%': 'Mod', '^': 'Pow' };
        const opAbsPreference = { '+': 'Abacus', '-': 'Abacus', '*': 'SlideRule', '/': 'SlideRule', '%': 'SlideRule', '^': 'SlideRule' };

        const regConv = (typeof METHOD_REGISTER_CONVENTIONS !== 'undefined') ? METHOD_REGISTER_CONVENTIONS : {};
        const bootUploads = (typeof BOOT_UPLOADS !== 'undefined') ? BOOT_UPLOADS : [];

        const nsSlotMap = {};
        for (const upload of bootUploads) {
            if (upload.index !== undefined && upload.abstraction) {
                nsSlotMap[upload.abstraction] = upload.index;
            }
        }

        const countArgs = (inputStr) => {
            if (!inputStr) return 0;
            return (inputStr.match(/DR\d+/g) || []).length;
        };

        const parseOutputDR = (outputStr) => {
            if (!outputStr) return 1;
            const match = outputStr.match(/DR(\d+)/);
            return match ? parseInt(match[1]) : 1;
        };

        const mathAbstractions = new Set(['Abacus', 'SlideRule', 'Constants']);
        const allMethods = [];

        for (const [absName, methods] of Object.entries(regConv)) {
            const nsSlot = nsSlotMap[absName];
            if (nsSlot === undefined) continue;
            for (const [methodName, conv] of Object.entries(methods)) {
                const args = countArgs(conv.input);
                const outputDR = parseOutputDR(conv.output);
                const entry = { abs: absName, nsSlot, methodIndex: conv.index, args, outputDR };
                funcTable[methodName.toLowerCase()] = entry;
                allMethods.push({ key: methodName.toLowerCase(), entry });
            }
        }

        const abacusArgMap = { add: 2, sub: 2, mul: 2, div: 2, mod: 2, abs: 1, pi: 0, e: 0, phi: 0, zero: 0, one: 0 };

        for (const upload of bootUploads) {
            if (!upload.methods || !upload.methods.length) continue;
            const absName = upload.abstraction;
            const nsSlot = upload.index;
            if (regConv[absName]) continue;
            if (!mathAbstractions.has(absName)) continue;
            for (let mi = 0; mi < upload.methods.length; mi++) {
                const m = upload.methods[mi];
                const key = m.name.toLowerCase();
                const args = (abacusArgMap[key] !== undefined) ? abacusArgMap[key] : 1;
                const entry = { abs: absName, nsSlot, methodIndex: mi, args, outputDR: 1 };
                allMethods.push({ key, entry });
                if (!funcTable[key] || (mathAbstractions.has(absName) && !mathAbstractions.has(funcTable[key].abs))) {
                    funcTable[key] = entry;
                }
            }
        }

        for (const [op, methodName] of Object.entries(opMapping)) {
            const prefAbs = opAbsPreference[op];
            const key = methodName.toLowerCase();
            const preferred = allMethods.find(m => m.key === key && m.entry.abs === prefAbs);
            if (preferred) {
                opTable[op] = { abs: preferred.entry.abs, nsSlot: preferred.entry.nsSlot, method: methodName, methodIndex: preferred.entry.methodIndex };
            } else if (funcTable[key]) {
                const entry = funcTable[key];
                opTable[op] = { abs: entry.abs, nsSlot: entry.nsSlot, method: methodName, methodIndex: entry.methodIndex };
            }
        }

        if (!opTable['+']) opTable['+'] = { abs: 'Abacus', nsSlot: 17, method: 'Add', methodIndex: 0 };
        if (!opTable['-']) opTable['-'] = { abs: 'Abacus', nsSlot: 17, method: 'Sub', methodIndex: 1 };
        if (!opTable['*']) opTable['*'] = { abs: 'SlideRule', nsSlot: 16, method: 'Multiply', methodIndex: 0 };
        if (!opTable['/']) opTable['/'] = { abs: 'SlideRule', nsSlot: 16, method: 'Divide', methodIndex: 1 };
        if (!opTable['%']) opTable['%'] = { abs: 'SlideRule', nsSlot: 16, method: 'Mod', methodIndex: 3 };
        if (!opTable['^']) opTable['^'] = { abs: 'SlideRule', nsSlot: 16, method: 'Pow', methodIndex: 14 };

        const funcNames = Object.keys(funcTable)
            .map(k => k.charAt(0).toUpperCase() + k.slice(1))
            .filter((v, i, a) => a.indexOf(v) === i)
            .join(', ');

        return { opTable, funcTable, funcNames };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CLOOMCCompiler;
}
