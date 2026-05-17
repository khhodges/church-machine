class ChurchREPL {
    constructor(sim, pipeline) {
        this.sim = sim;
        this.pipeline = pipeline;
        this.variables = {};
        this.ans = 0;
        this.history = [];
        this.outputLines = [];
        this.pipelineMode = 'full';

        this.operations = {
            'succ': (a) => a + 1,
            'pred': (a) => Math.max(0, a - 1),
            'sqrt': (a) => Math.sqrt(a),
            'log':  (a) => Math.log(a),
            'exp':  (a) => Math.exp(a),
        };

        this.constants = {
            'pi':        Math.PI,
            '\u03C0':    Math.PI,
            'e':         Math.E,
            'phi':       (1 + Math.sqrt(5)) / 2,
            '\u03C6':    (1 + Math.sqrt(5)) / 2,
            'tau':       2 * Math.PI,
            '\u03C4':    2 * Math.PI,
            'inf':       Infinity,
            '\u221E':    Infinity,
            'sqrt2':     Math.SQRT2,
            '\u221A2':   Math.SQRT2,
            'sqrt3':     Math.sqrt(3),
            'ln2':       Math.LN2,
            'ln10':      Math.LN10,
            'log2e':     Math.LOG2E,
            'log10e':    Math.LOG10E,
            'c':         299792458,
            'G':         6.67430e-11,
            'g':         9.80665,
            'h':         6.62607e-34,
            'hbar':      1.05457e-34,
            '\u210F':    1.05457e-34,
            'kb':        1.38065e-23,
            'Na':        6.02214e23,
            'R':         8.31446,
            'e0':        8.85419e-12,
            '\u03B5\u2080': 8.85419e-12,
            'mu0':       1.25664e-6,
            '\u03BC\u2080': 1.25664e-6,
            'qe':        1.60218e-19,
            'me':        9.10938e-31,
            'mp':        1.67262e-27,
            'sigma':     5.67037e-8,
        };
    }

    setPipelineMode(mode) {
        this.pipelineMode = mode;
    }

    execute(input) {
        input = input.trim();
        if (!input) return null;

        if (!this.sim.bootComplete) {
            while (!this.sim.bootComplete) { this.sim._bootStep(); }
        }

        const commentIdx = input.indexOf('--');
        if (commentIdx === 0) return null;
        if (commentIdx > 0) input = input.substring(0, commentIdx).trim();

        this.history.push(input);
        const upper = input.toUpperCase();

        if (upper === 'VARS') return this._showVars();
        if (upper === 'CLEAR') return this._clear();
        if (upper === 'RESET') return this._reset();
        if (upper === 'HELP') return this._help();
        if (upper === 'EXIT' || upper === 'QUIT') return { type: 'info', text: 'Session continues. Type CLEAR to reset.' };

        if (input.toLowerCase().startsWith('let ')) {
            return this._parseLet(input.substring(4).trim());
        }

        return this._evalExpr(input);
    }

    _parseLet(assignment) {
        const eqIdx = assignment.indexOf('=');
        if (eqIdx < 0) {
            // "let " prefix is 4 chars; underline the whole assignment
            return { type: 'error', text: 'Syntax: let name = expression', colStart: 4, colEnd: 4 + assignment.length };
        }
        const name = assignment.substring(0, eqIdx).trim();
        const expr = assignment.substring(eqIdx + 1).trim();

        if (!name.match(/^[a-zA-Z_\u0391-\u03C9\u210F\u221A\u221E][a-zA-Z0-9_\u0391-\u03C9\u2080-\u209C\u2070-\u207F\u00B2\u00B3\u00B9\u207A\u207B]*$/)) {
            // name starts after "let " (4 chars)
            const nameStart = 4 + assignment.indexOf(name);
            return { type: 'error', text: `Invalid variable name: ${name}`, colStart: nameStart, colEnd: nameStart + name.length };
        }

        // Position of expr within the full command ("let " + assignment)
        const exprPosInAssignment = assignment.indexOf(expr, eqIdx + 1);
        const exprOffset = 4 + (exprPosInAssignment >= 0 ? exprPosInAssignment : eqIdx + 1);

        const result = this._evaluate(expr);
        if (result.error) {
            let colStart, colEnd;
            if (result.errorToken !== undefined) {
                const idx = expr.indexOf(result.errorToken);
                if (idx >= 0) {
                    colStart = exprOffset + idx;
                    colEnd   = colStart + result.errorToken.length;
                }
            }
            return { type: 'error', text: result.error, colStart, colEnd };
        }

        this.variables[name] = result.value;
        this.ans = result.value;

        const pipelineTrace = result.pipeline || [];
        const displayVal = Number.isInteger(result.value) ? result.value : result.value.toFixed(6);

        return {
            type: 'result',
            text: `${name} = ${displayVal}`,
            value: result.value,
            pipeline: pipelineTrace,
            churchSteps: result.churchSteps || [],
            variable: name,
            cycles: result.cycles || 7,
        };
    }

    _evalExpr(input) {
        const result = this._evaluate(input);
        if (result.error) {
            let colStart, colEnd;
            if (result.errorToken !== undefined) {
                const idx = input.indexOf(result.errorToken);
                if (idx >= 0) {
                    colStart = idx;
                    colEnd   = idx + result.errorToken.length;
                }
            }
            return { type: 'error', text: result.error, colStart, colEnd };
        }
        this.ans = result.value;
        const displayVal = Number.isInteger(result.value) ? result.value : result.value.toFixed(6);
        return {
            type: 'result',
            text: `= ${displayVal}`,
            value: result.value,
            pipeline: result.pipeline || [],
            churchSteps: result.churchSteps || [],
            cycles: result.cycles || 7,
        };
    }

    _preprocess(expr) {
        var SUPER_TO_DIGIT = {
            '\u2070':'0','\u00B9':'1','\u00B2':'2','\u00B3':'3','\u2074':'4',
            '\u2075':'5','\u2076':'6','\u2077':'7','\u2078':'8','\u2079':'9',
            '\u207A':'+','\u207B':'-','\u207F':'n','\u2071':'i'
        };
        var result = '';
        var i = 0;
        while (i < expr.length) {
            var ch = expr[i];
            if (SUPER_TO_DIGIT[ch] !== undefined) {
                var exp = '';
                while (i < expr.length && SUPER_TO_DIGIT[expr[i]] !== undefined) {
                    exp += SUPER_TO_DIGIT[expr[i]];
                    i++;
                }
                result += '^' + exp;
            } else {
                result += ch;
                i++;
            }
        }
        expr = result;

        var isIdChar = function(c) {
            if (!c) return false;
            if (/[a-zA-Z0-9_]/.test(c)) return true;
            var cp = c.charCodeAt(0);
            return (cp >= 0x0391 && cp <= 0x03C9) || c === '\u221A' || c === '\u210F' || c === '\u221E' ||
                   (cp >= 0x2080 && cp <= 0x209C);
        };
        var isDigitOrDot = function(c) { return c && /[0-9.]/.test(c); };
        var isValueEnd = function(c) { return isIdChar(c) || isDigitOrDot(c) || c === ')'; };
        var isValueStart = function(c) { return isIdChar(c) || isDigitOrDot(c) || c === '('; };

        result = '';
        for (i = 0; i < expr.length; i++) {
            result += expr[i];
            if (i + 1 < expr.length) {
                var cur = expr[i];
                var next = expr[i + 1];
                var needsMul = false;
                if (isDigitOrDot(cur) && isIdChar(next) && !isDigitOrDot(next)) needsMul = true;
                if (isDigitOrDot(cur) && next === '(') needsMul = true;
                if (cur === ')' && (isIdChar(next) || isDigitOrDot(next) || next === '(')) needsMul = true;
                if (isIdChar(cur) && next === '(' && !/[a-zA-Z_]/.test(cur)) needsMul = true;
                if (needsMul) {
                    result += ' * ';
                }
            }
        }
        expr = result;

        var tokens = expr.split(/\s+/);
        result = '';
        for (i = 0; i < tokens.length; i++) {
            if (i > 0) {
                var prev = tokens[i - 1];
                var tok = tokens[i];
                var prevEnd = prev[prev.length - 1];
                var tokStart = tok[0];
                var prevIsOp = /^[+\-*/%^]$/.test(prev);
                var tokIsOp = /^[+\-*/%^]$/.test(tok);
                if (!prevIsOp && !tokIsOp && isValueEnd(prevEnd) && isValueStart(tokStart)) {
                    result += ' * ';
                } else {
                    result += ' ';
                }
            }
            result += tokens[i];
        }

        return result.trim();
    }

    _numberSteps(steps) {
        return steps.map((s, i) => {
            var stripped = s.replace(/^\d+\.\s*/, '');
            return `${i + 1}. ${stripped}`;
        });
    }

    _findOperator(expr) {
        var precedence = [['+', '-'], ['*', '/', '%'], ['^']];
        for (var p = 0; p < precedence.length; p++) {
            var ops = precedence[p];
            var depth = 0;
            var scanDir = (p === 2) ? 1 : -1;
            var start = scanDir === -1 ? expr.length - 1 : 0;
            var end = scanDir === -1 ? -1 : expr.length;
            for (var i = start; i !== end; i += scanDir) {
                var c = expr[i];
                if (c === '(') depth += (scanDir === -1 ? -1 : 1);
                else if (c === ')') depth += (scanDir === -1 ? 1 : -1);
                if (depth !== 0) continue;
                if (ops.indexOf(c) >= 0) {
                    var left = expr.substring(0, i).trim();
                    var right = expr.substring(i + 1).trim();
                    if (left && right) {
                        if ((c === '-' || c === '+') && i > 0 && /[+\-*/%^(]/.test(expr[i-1].trim() || expr[i-1])) continue;
                        return { left: left, op: c, right: right };
                    }
                }
            }
        }
        return null;
    }

    _evaluate(expr) {
        expr = this._preprocess(expr.trim());
        const churchSteps = [];
        let pipeline = [];

        if (expr.startsWith('(') && expr.endsWith(')')) {
            var depth = 0, matched = true;
            for (var ci = 0; ci < expr.length; ci++) {
                if (expr[ci] === '(') depth++;
                else if (expr[ci] === ')') depth--;
                if (depth === 0 && ci < expr.length - 1) { matched = false; break; }
            }
            if (matched) {
                return this._evaluate(expr.substring(1, expr.length - 1));
            }
        }

        const funcMatch = expr.match(/^(\w+)\((.+)\)$/);
        if (funcMatch) {
            const func = funcMatch[1].toLowerCase();
            const argExpr = funcMatch[2].trim();

            if (func === 'pow' && argExpr.includes(',')) {
                const parts = argExpr.split(',').map(s => s.trim());
                const base = this._evaluate(parts[0]);
                const exp = this._evaluate(parts[1]);
                if (base.error) return base;
                if (exp.error) return exp;
                const result = Math.pow(base.value, exp.value);
                const displayResult = Number.isInteger(result) ? result : result.toFixed(6);

                if (base.churchSteps) churchSteps.push(...base.churchSteps);
                if (exp.churchSteps) churchSteps.push(...exp.churchSteps);

                if (this.pipelineMode === 'full') {
                    churchSteps.push(
                        `A = ${base.value}`,
                        `B = ${exp.value}`,
                        `C = CALL.POW (A ^ B)`,
                    );
                    if (this.pipeline) {
                        pipeline = this.pipeline.buildSecurityTrace('CALL', { target: 'POW', result: displayResult });
                    }
                    return { value: result, churchSteps, pipeline, cycles: 4 + (base.cycles || 0) + (exp.cycles || 0) };
                } else {
                    churchSteps.push(
                        `ELOADCALL   CR7, CR6, ${this._nsIndex('POW')}  ; LOAD+TPERM(E)+CALL \u2192 POW`,
                        `XLOADLAMBDA CR0, CR6, 1                     ; LOAD+TPERM(X)+LAMBDA \u2192 ${displayResult}`,
                        `RETURN                                       ; Result in DR0`,
                    );
                    if (this.pipeline) {
                        pipeline = this.pipeline.buildSecurityTrace('ELOADCALL', { target: 'POW', result: displayResult });
                    }
                    return { value: result, churchSteps: this._numberSteps(churchSteps), pipeline, cycles: 3 + (base.cycles || 0) + (exp.cycles || 0) };
                }
            }

            const argResult = this._evaluate(argExpr);
            if (argResult.error) return argResult;

            if (this.operations[func]) {
                const result = this.operations[func](argResult.value);
                const opMap = { succ: 'SUCC', pred: 'PRED', sqrt: 'SQRT', log: 'LOG', exp: 'EXP' };
                const abstraction = opMap[func] || func.toUpperCase();
                const displayResult = Number.isInteger(result) ? result : result.toFixed(6);

                if (argResult.churchSteps) churchSteps.push(...argResult.churchSteps);

                if (this.pipelineMode === 'full') {
                    churchSteps.push(
                        `A = ${argResult.value}`,
                        `C = CALL.${abstraction} (${func}(A))`,
                    );
                    if (this.pipeline) {
                        pipeline = this.pipeline.buildSecurityTrace('CALL', { target: abstraction, result: displayResult });
                    }
                    return { value: result, churchSteps, pipeline, cycles: 2 + (argResult.cycles || 0) };
                } else {
                    churchSteps.push(
                        `ELOADCALL   CR7, CR6, ${this._nsIndex(abstraction)}  ; LOAD+TPERM(E)+CALL \u2192 ${abstraction}`,
                        `XLOADLAMBDA CR0, CR6, 1                     ; LOAD+TPERM(X)+LAMBDA \u2192 ${displayResult}`,
                        `RETURN                                       ; Result in DR0`,
                    );
                    if (this.pipeline) {
                        pipeline = this.pipeline.buildSecurityTrace('ELOADCALL', { target: abstraction, result: displayResult });
                    }
                    return { value: result, churchSteps: this._numberSteps(churchSteps), pipeline, cycles: 3 + (argResult.cycles || 0) };
                }
            }

            return { error: `Unknown function: ${func}`, errorToken: func };
        }

        var opInfo = this._findOperator(expr);
        if (opInfo) {
            const leftExpr = opInfo.left;
            const op = opInfo.op;
            const rightExpr = opInfo.right;

            const left = this._evaluate(leftExpr);
            if (left.error) return left;
            const right = this._evaluate(rightExpr);
            if (right.error) return right;

            let result, abstraction;
            switch (op) {
                case '+': result = left.value + right.value; abstraction = 'ADD'; break;
                case '-': result = left.value - right.value; abstraction = 'SUB'; break;
                case '*': result = left.value * right.value; abstraction = 'MUL'; break;
                case '/':
                    if (right.value === 0) return { error: 'Division by zero', errorToken: op };
                    result = left.value / right.value; abstraction = 'DIV'; break;
                case '%':
                    if (right.value === 0) return { error: 'Modulo by zero', errorToken: op };
                    result = left.value % right.value; abstraction = 'MOD'; break;
                case '^': result = Math.pow(left.value, right.value); abstraction = 'POW'; break;
                default: return { error: `Unknown operator: ${op}`, errorToken: op };
            }

            const displayResult = Number.isInteger(result) ? result : result.toFixed(6);

            if (left.churchSteps) churchSteps.push(...left.churchSteps);
            if (right.churchSteps) churchSteps.push(...right.churchSteps);

            if (this.pipelineMode === 'full') {
                churchSteps.push(
                    `A = ${left.value}`,
                    `B = ${right.value}`,
                    `C = CALL.${abstraction} (A ${op} B)`,
                );
                if (this.pipeline) {
                    pipeline = this.pipeline.buildSecurityTrace('CALL', { target: abstraction, result: displayResult });
                }
                return { value: result, churchSteps, pipeline, cycles: 4 + (left.cycles || 0) + (right.cycles || 0) };
            } else {
                churchSteps.push(
                    `ELOADCALL   CR7, CR6, ${this._nsIndex(abstraction)}  ; LOAD+TPERM(E)+CALL \u2192 ${abstraction}`,
                    `XLOADLAMBDA CR0, CR6, 1                     ; LOAD+TPERM(X)+LAMBDA \u2192 ${displayResult}`,
                    `RETURN                                       ; Result in DR0`,
                );
                if (this.pipeline) {
                    pipeline = this.pipeline.buildSecurityTrace('ELOADCALL', { target: abstraction, result: displayResult });
                }
                return { value: result, churchSteps: this._numberSteps(churchSteps), pipeline, cycles: 3 + (left.cycles || 0) + (right.cycles || 0) };
            }
        }

        if (expr.toUpperCase() === 'ANS') {
            return { value: this.ans, cycles: 0 };
        }

        if (this.variables[expr] !== undefined) {
            return { value: this.variables[expr], cycles: 0 };
        }

        if (this.constants[expr] !== undefined) {
            return { value: this.constants[expr], cycles: 0 };
        }

        if (/^-?\d+(\.\d+)?$/.test(expr)) {
            return { value: parseFloat(expr), cycles: 0 };
        }

        return { error: `Undefined: ${expr}`, errorToken: expr };
    }

    executeChain(abstraction, methods, args) {
        const churchSteps = [];
        let pipeline = [];
        const intermediates = [];

        churchSteps.push(`1. ELOADCALL CR7, CR6, ${this._nsIndex(abstraction)}  ; Enter ${abstraction} (LOAD+TPERM+CALL)`);

        let accumulator = args[0] || 0;
        for (let i = 0; i < methods.length; i++) {
            const method = methods[i];
            const operand = args[i + 1] !== undefined ? args[i + 1] : accumulator;
            let result;
            switch (method.toUpperCase()) {
                case 'ADD': result = accumulator + operand; break;
                case 'SUB': result = accumulator - operand; break;
                case 'MUL': result = accumulator * operand; break;
                case 'DIV': result = operand !== 0 ? accumulator / operand : 0; break;
                case 'POW': result = Math.pow(accumulator, operand); break;
                case 'SUCC': result = accumulator + 1; break;
                case 'PRED': result = Math.max(0, accumulator - 1); break;
                default: result = accumulator;
            }
            const displayResult = Number.isInteger(result) ? result : result.toFixed(6);
            intermediates.push(displayResult);
            churchSteps.push(`${i + 2}. XLOADLAMBDA CR0, CR6, ${this._nsIndex(method.toUpperCase())}  ; ${method}(${accumulator}${operand !== accumulator ? ', ' + operand : ''}) \u2192 ${displayResult}`);
            accumulator = result;
        }

        const stepNum = methods.length + 2;
        churchSteps.push(`${stepNum}. RETURN                                     ; Result = ${Number.isInteger(accumulator) ? accumulator : accumulator.toFixed(6)}`);

        if (this.pipeline) {
            pipeline = this.pipeline.buildSecurityTrace('CHAIN', {
                target: abstraction,
                methods: methods,
                intermediates: intermediates,
                result: Number.isInteger(accumulator) ? accumulator.toString() : accumulator.toFixed(6),
            });
        }

        const cycles = 1 + methods.length + 1;
        return { value: accumulator, churchSteps, pipeline, cycles, intermediates };
    }

    _nsIndex(name) {
        const map = {
            'Boot.NS': 0, 'Boot.Thread': 1, '(free)': 2, 'Boot.Abstr': 3,
            'Salvation': 4, 'Navana': 5,
            'Mint': 6, 'Memory': 7, 'Scheduler': 8, 'Stack': 9,
            'DijkstraFlag': 10, 'UART': 11, 'LED': 12, 'Button': 13,
            'Timer': 14, 'Display': 15, 'SlideRule': 16, 'Abacus': 17,
            'Constants': 18, 'Loader': 19,
            'SUCC': 20, 'PRED': 21, 'ADD': 22, 'SUB': 23,
            'MUL': 24, 'ISZERO': 25, 'TRUE': 26, 'FALSE': 27,
            'Family': 28, 'Schoolroom': 29, 'Friends': 30,
            'Tunnel': 31, 'Negotiate': 32,
            'Editor': 33, 'Assembler': 34, 'Debugger': 35, 'Deployer': 36,
            'Browser': 37, 'Messenger': 38, 'Photos': 39,
            'Social': 40, 'Video': 41, 'Email': 42,
            'PAIR': 43, 'GC': 44, 'Thread': 45, 'Circle': 46,
        };
        return map[name] !== undefined ? map[name] : '?';
    }

    _showVars() {
        if (Object.keys(this.variables).length === 0) {
            return { type: 'info', text: 'No variables defined.' };
        }
        const lines = Object.entries(this.variables).map(([k, v]) => {
            const displayVal = Number.isInteger(v) ? v : v.toFixed(6);
            return `  ${k} = ${displayVal}`;
        });
        return { type: 'info', text: 'Variables:\n' + lines.join('\n') };
    }

    _clear() {
        this.variables = {};
        this.ans = 0;
        return { type: 'info', text: 'All variables cleared.' };
    }

    _reset() {
        this.variables = {};
        this.ans = 0;
        this.history = [];
        this.outputLines = [];
        if (this.sim) this.sim.reset();
        return { type: 'info', text: 'Full reset complete.' };
    }

    _help() {
        return {
            type: 'info',
            text: [
                'Church Computer Pure Math \u2014 Pure Lambda Calculus',
                '',
                'Arithmetic:  3 + 5, 10 * 2, 8 / 4, 2 ^ 3',
                'Functions:   succ(n), pred(n), sqrt(x), log(x), exp(x)',
                'Variables:   let n = 4',
                '             let result = n * succ(n)',
                'Constants:   pi \u03C0, e, phi \u03C6, tau \u03C4, inf \u221E',
                '  Roots:     sqrt2 \u221A2, sqrt3, ln2, ln10, log2e, log10e',
                '  Physics:   c, G, g, h, hbar \u210F, kb, Na, R',
                '             qe, me, mp, sigma, e0 \u03B5\u2080, mu0 \u03BC\u2080',
                'Special:     ANS (last result), VARS (show all), CLEAR (reset)',
                '',
                'Pipeline modes:',
                '  Full:  DREAD args \u2192 CALL abstraction (envelope opens/closes) \u2192 RETURN',
                '  Fused (3-step): ELOADCALL \u2192 XLOADLAMBDA \u2192 RETURN',
                '  Chained (1 call): ELOADCALL \u2192 N\u00d7XLOADLAMBDA \u2192 RETURN',
            ].join('\n'),
        };
    }

    runProgram(source) {
        const lines = source.split('\n');
        const results = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('--')) continue;
            if (trimmed.toUpperCase() === 'EXIT') break;
            const result = this.execute(trimmed);
            if (result) results.push(result);
        }
        return results;
    }

    compileSession() {
        const bindings = [];
        for (const [name, value] of Object.entries(this.variables)) {
            bindings.push({ name, value });
        }
        if (bindings.length === 0) {
            return { type: 'info', text: 'No variables defined. Use "let V1 = 42" to define variables first.' };
        }

        let source = `-- Pure Math Session compiled to Symbolic Math\n`;
        source += `-- ${bindings.length} variable(s)\n\n`;
        source += `abstraction MathSession {\n`;
        source += `    capabilities {\n    }\n\n`;
        source += `    method compute() {\n`;

        for (const cmd of this.history) {
            const trimmed = cmd.trim();
            if (!trimmed || trimmed.startsWith('--')) continue;
            const upper = trimmed.toUpperCase();
            if (['VARS', 'CLEAR', 'RESET', 'HELP', 'EXIT', 'QUIT'].includes(upper)) continue;
            if (trimmed.toLowerCase().startsWith('let ') || trimmed.match(/^\w+\s*=/)) {
                source += `        ${trimmed}\n`;
            }
        }

        source += `        halt\n`;
        source += `    }\n`;
        source += `}\n`;

        if (typeof cloomcCompiler === 'undefined' || !cloomcCompiler) {
            return {
                type: 'info',
                text: `Session source (paste into Code tab with Symbolic Math selected):\n\n${source}`
            };
        }

        const result = cloomcCompiler.compileSymbolic(source, []);
        if (result.errors && result.errors.length > 0) {
            return { type: 'compile_errors', errors: result.errors, source };
        }

        let output = `═══ Pure Math Session → Church Machine Code ═══\n\n`;
        output += `Language: Symbolic Math (Ada)\n`;
        output += `Abstraction: "${result.abstractionName}"\n`;
        output += `Methods: ${result.methods.length}\n\n`;

        const manifestByMethod = {};
        if (result.manifest) {
            for (const entry of result.manifest) {
                const comments = {};
                if (entry.mapping) {
                    let seqIdx = 0;
                    for (const m of entry.mapping) {
                        if (m.comment !== undefined) {
                            comments[seqIdx++] = m.comment;
                        } else if (m.addr !== undefined && m.desc) {
                            comments[m.addr] = m.desc;
                        }
                    }
                }
                manifestByMethod[entry.name] = comments;
            }
        }

        // Build method table entries (mirrors loadCLOOMCIntoSim layout).
        // Layout: lump word 0 = header; words 1..N = method table; words N+1.. = bodies.
        const caps = result.capabilities || [];
        const clistCount = caps.length;
        const methodTableSize = result.methods.length;
        let bodyOffset = 0;
        const methodTableEntries = [];
        for (const m of result.methods) {
            // public entry = lump-word address of body start; private = 0
            methodTableEntries.push(m.visibility === 'private' ? 0 : methodTableSize + 1 + bodyOffset);
            bodyOffset += (m.code || []).length;
        }
        const totalCodeWords = bodyOffset;

        // ── Method Table ──
        output += `  Method Table:\n`;
        output += `    [word  0] 0x00000000  (lump header)\n`;
        for (let i = 0; i < result.methods.length; i++) {
            const m = result.methods[i];
            const entry = methodTableEntries[i];
            const isPrivate = m.visibility === 'private';
            const entryHex = `0x${entry.toString(16).padStart(8, '0').toUpperCase()}`;
            const idxLabel = String(i + 1).padStart(2);
            if (isPrivate) {
                output += `    [word ${idxLabel}] ${entryHex}  [${i}] ${m.name}  (private)\n`;
            } else {
                output += `    [word ${idxLabel}] ${entryHex}  [${i}] ${m.name}  \u2192 lump word ${entry}\n`;
            }
        }
        output += `\n`;

        // ── Method Bodies ──
        let lumpBodyBase = methodTableSize + 1; // lump-word address of first body instruction
        for (const m of result.methods) {
            const isPrivate = m.visibility === 'private';
            const privLabel = isPrivate ? '  (private)' : '';
            output += `  method ${m.name}${privLabel}: ${m.code.length} instruction(s)\n`;
            const comments = manifestByMethod[m.name] || {};
            for (let i = 0; i < m.code.length; i++) {
                const word = m.code[i];
                const hex = `0x${word.toString(16).padStart(8, '0').toUpperCase()}`;
                const disasm = (typeof assembler !== 'undefined' && assembler) ? assembler.disassemble(word) : '';
                const comment = comments[i];
                const lumpWord = lumpBodyBase + i;
                const base = `    [word ${String(lumpWord).padStart(2)}] ${hex}  ${disasm}`;
                output += comment ? `${base.padEnd(60)}; ${comment}\n` : `${base}\n`;
            }
            lumpBodyBase += m.code.length;
        }

        // ── Lump summary ──
        // +1 for lump header placeholder at word 0; method table at words 1..N.
        const codeSize = methodTableSize + 1 + totalCodeWords;
        const neededSize = codeSize + clistCount;
        const allocSize = Math.max(32, Math.pow(2, Math.ceil(Math.log2(Math.max(neededSize, 1)))));

        output += `\n  Lump: ${codeSize} code + ${clistCount} c-list = ${neededSize} words`;
        output += ` (alloc ${allocSize})\n`;
        output += `\n═══ Source ═══\n${source}`;

        return { type: 'result', text: output };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChurchREPL;
}
