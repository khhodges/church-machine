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
            return { type: 'error', text: 'Syntax: let name = expression' };
        }
        const name = assignment.substring(0, eqIdx).trim();
        const expr = assignment.substring(eqIdx + 1).trim();

        if (!name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
            return { type: 'error', text: `Invalid variable name: ${name}` };
        }

        const result = this._evaluate(expr);
        if (result.error) {
            return { type: 'error', text: result.error };
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
            return { type: 'error', text: result.error };
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

    _evaluate(expr) {
        expr = expr.trim();
        const churchSteps = [];
        let pipeline = [];

        const funcMatch = expr.match(/^(\w+)\((.+)\)$/);
        if (funcMatch) {
            const func = funcMatch[1].toLowerCase();
            const argExpr = funcMatch[2].trim();
            const argResult = this._evaluate(argExpr);
            if (argResult.error) return argResult;

            if (this.operations[func]) {
                const result = this.operations[func](argResult.value);
                const opMap = { succ: 'SUCC', pred: 'PRED', sqrt: 'SQRT', log: 'LOG', exp: 'EXP' };
                const abstraction = opMap[func] || func.toUpperCase();
                const displayResult = Number.isInteger(result) ? result : result.toFixed(6);

                if (this.pipelineMode === 'full') {
                    churchSteps.push(
                        `A = ${argResult.value}`,
                        `C = CALL.${abstraction} (${func}(A))`,
                    );
                    if (this.pipeline) {
                        pipeline = this.pipeline.buildSecurityTrace('CALL', { target: abstraction, result: displayResult });
                    }
                    return { value: result, churchSteps, pipeline, cycles: 2 };
                } else {
                    churchSteps.push(
                        `1. ELOADCALL   CR7, CR6, ${this._nsIndex(abstraction)}  ; LOAD+TPERM(E)+CALL \u2192 ${abstraction}`,
                        `2. XLOADLAMBDA CR0, CR6, 1                     ; LOAD+TPERM(X)+LAMBDA \u2192 ${displayResult}`,
                        `3. RETURN      CR7                             ; Result in DR0`,
                    );
                    if (this.pipeline) {
                        pipeline = this.pipeline.buildSecurityTrace('ELOADCALL', { target: abstraction, result: displayResult });
                    }
                    return { value: result, churchSteps, pipeline, cycles: 3 };
                }
            }

            if (func === 'pow' && argExpr.includes(',')) {
                const parts = argExpr.split(',').map(s => s.trim());
                const base = this._evaluate(parts[0]);
                const exp = this._evaluate(parts[1]);
                if (base.error) return base;
                if (exp.error) return exp;
                const result = Math.pow(base.value, exp.value);
                const displayResult = Number.isInteger(result) ? result : result.toFixed(6);

                if (this.pipelineMode === 'full') {
                    churchSteps.push(
                        `A = ${base.value}`,
                        `B = ${exp.value}`,
                        `C = CALL.POW (A ^ B)`,
                    );
                    if (this.pipeline) {
                        pipeline = this.pipeline.buildSecurityTrace('CALL', { target: 'POW', result: displayResult });
                    }
                    return { value: result, churchSteps, pipeline, cycles: 4 };
                } else {
                    churchSteps.push(
                        `1. ELOADCALL   CR7, CR6, ${this._nsIndex('POW')}  ; LOAD+TPERM(E)+CALL \u2192 POW`,
                        `2. XLOADLAMBDA CR0, CR6, 1                     ; LOAD+TPERM(X)+LAMBDA \u2192 ${displayResult}`,
                        `3. RETURN      CR7                             ; Result in DR0`,
                    );
                    if (this.pipeline) {
                        pipeline = this.pipeline.buildSecurityTrace('ELOADCALL', { target: 'POW', result: displayResult });
                    }
                    return { value: result, churchSteps, pipeline, cycles: 3 };
                }
            }

            return { error: `Unknown function: ${func}` };
        }

        const opMatch = expr.match(/^(.+?)\s*([+\-*/%^])\s*(.+)$/);
        if (opMatch) {
            const leftExpr = opMatch[1].trim();
            const op = opMatch[2];
            const rightExpr = opMatch[3].trim();

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
                    if (right.value === 0) return { error: 'Division by zero' };
                    result = left.value / right.value; abstraction = 'DIV'; break;
                case '%':
                    if (right.value === 0) return { error: 'Modulo by zero' };
                    result = left.value % right.value; abstraction = 'MOD'; break;
                case '^': result = Math.pow(left.value, right.value); abstraction = 'POW'; break;
                default: return { error: `Unknown operator: ${op}` };
            }

            const displayResult = Number.isInteger(result) ? result : result.toFixed(6);

            if (this.pipelineMode === 'full') {
                churchSteps.push(
                    `A = ${left.value}`,
                    `B = ${right.value}`,
                    `C = CALL.${abstraction} (A ${op} B)`,
                );
                if (this.pipeline) {
                    pipeline = this.pipeline.buildSecurityTrace('CALL', { target: abstraction, result: displayResult });
                }
                return { value: result, churchSteps, pipeline, cycles: 4 };
            } else {
                churchSteps.push(
                    `1. ELOADCALL   CR7, CR6, ${this._nsIndex(abstraction)}  ; LOAD+TPERM(E)+CALL \u2192 ${abstraction}`,
                    `2. XLOADLAMBDA CR0, CR6, 1                     ; LOAD+TPERM(X)+LAMBDA \u2192 ${displayResult}`,
                    `3. RETURN      CR7                             ; Result in DR0`,
                );
                if (this.pipeline) {
                    pipeline = this.pipeline.buildSecurityTrace('ELOADCALL', { target: abstraction, result: displayResult });
                }
                return { value: result, churchSteps, pipeline, cycles: 3 };
            }
        }

        if (expr.toUpperCase() === 'ANS') {
            return { value: this.ans, cycles: 0 };
        }

        if (this.variables[expr] !== undefined) {
            return { value: this.variables[expr], cycles: 0 };
        }

        if (/^-?\d+(\.\d+)?$/.test(expr)) {
            return { value: parseFloat(expr), cycles: 0 };
        }

        return { error: `Undefined: ${expr}` };
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
            'Boot.NS': 0, 'Boot.Thread': 1, 'Boot.CList': 2,
            'Boot.CLOOMC': 3, 'Salvation': 4, 'Navana': 5,
            'Mint': 6, 'Memory': 7, 'Scheduler': 8, 'Stack': 9,
            'DijkstraFlag': 10, 'UART': 11, 'LED': 12, 'Button': 13,
            'Timer': 14, 'Display': 15, 'SlideRule': 16, 'Abacus': 17,
            'Constants': 18, 'Circle': 19,
            'SUCC': 20, 'PRED': 21, 'ADD': 22, 'SUB': 23,
            'MUL': 24, 'ISZERO': 25, 'TRUE': 26, 'FALSE': 27,
            'Family': 28, 'Schoolroom': 29, 'Friends': 30,
            'Tunnel': 31, 'Negotiate': 32,
            'Editor': 33, 'Assembler': 34, 'Debugger': 35, 'Deployer': 36,
            'Browser': 37, 'Messenger': 38, 'Photos': 39,
            'Social': 40, 'Video': 41, 'Email': 42,
            'PAIR': 43, 'GC': 44,
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
                'Church Computer Interactive Math \u2014 Pure Lambda Calculus',
                '',
                'Arithmetic:  3 + 5, 10 * 2, 8 / 4, 2 ^ 3',
                'Functions:   succ(n), pred(n), sqrt(x), log(x), exp(x)',
                'Variables:   let n = 4',
                '             let result = n * succ(n)',
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

        let source = `-- Interactive Math Session compiled to Symbolic Math\n`;
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
            const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
            return { type: 'result', text: `Compile errors:\n${errText}\n\nSource:\n${source}` };
        }

        let output = `═══ Interactive Math Session → Church Machine Code ═══\n\n`;
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

        for (const m of result.methods) {
            output += `  method ${m.name}: ${m.code.length} instruction(s)\n`;
            const comments = manifestByMethod[m.name] || {};
            for (let i = 0; i < m.code.length; i++) {
                const word = m.code[i];
                const hex = `0x${word.toString(16).padStart(8, '0').toUpperCase()}`;
                const disasm = (typeof assembler !== 'undefined' && assembler) ? assembler.disassemble(word) : '';
                const comment = comments[i];
                const base = `    [${i}] ${hex}  ${disasm}`;
                output += comment ? `${base.padEnd(55)}; ${comment}\n` : `${base}\n`;
            }
        }

        const caps = result.capabilities || [];
        const clistCount = caps.length;
        let totalCodeWords = 0;
        for (const m of result.methods) totalCodeWords += (m.code || []).length;
        const methodTableSize = result.methods.length;
        const codeSize = methodTableSize + totalCodeWords;
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
