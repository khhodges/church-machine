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
                        `1. LOAD  CR7, [CR6 + ${this._nsIndex(abstraction)}]  ; Load ${abstraction}`,
                        `2. TPERM CR7, E                               ; Verify entry`,
                        `3. CALL  CR7                                  ; Enter ${abstraction}`,
                        `4. LOAD  CR0, [CR6 + 1]                       ; Access Code`,
                        `5. TPERM CR0, X                               ; Verify execute`,
                        `6. LAMBDA CR0                                 ; ${func}(${argResult.value}) \u2192 ${displayResult}`,
                        `7. RETURN CR7                                 ; Result in DR0`,
                    );
                    if (this.pipeline) {
                        pipeline = this.pipeline.buildSecurityTrace('CALL', { target: abstraction, result: displayResult });
                    }
                    return { value: result, churchSteps, pipeline, cycles: 7 };
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
                        `1. LOAD  CR7, [CR6 + ${this._nsIndex('POW')}]  ; Load POW`,
                        `2. TPERM CR7, E`,
                        `3. CALL  CR7`,
                        `4. LOAD  CR0, [CR6 + 1]`,
                        `5. TPERM CR0, X`,
                        `6. LAMBDA CR0  ; pow(${base.value}, ${exp.value}) \u2192 ${displayResult}`,
                        `7. RETURN CR7`,
                    );
                    if (this.pipeline) {
                        pipeline = this.pipeline.buildSecurityTrace('CALL', { target: 'POW', result: displayResult });
                    }
                    return { value: result, churchSteps, pipeline, cycles: 7 };
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
                    result = left.value % right.value; abstraction = 'DIV'; break;
                case '^': result = Math.pow(left.value, right.value); abstraction = 'POW'; break;
                default: return { error: `Unknown operator: ${op}` };
            }

            const displayResult = Number.isInteger(result) ? result : result.toFixed(6);

            if (this.pipelineMode === 'full') {
                churchSteps.push(
                    `1. LOAD  CR7, [CR6 + ${this._nsIndex(abstraction)}]  ; Load ${abstraction}`,
                    `2. TPERM CR7, E                               ; Verify entry`,
                    `3. CALL  CR7                                  ; Enter ${abstraction}`,
                    `4. LOAD  CR0, [CR6 + 1]                       ; Access Code`,
                    `5. TPERM CR0, X                               ; Verify execute`,
                    `6. LAMBDA CR0                                 ; ${left.value} ${op} ${right.value} \u2192 ${displayResult}`,
                    `7. RETURN CR7                                 ; Result in DR0`,
                );
                if (this.pipeline) {
                    pipeline = this.pipeline.buildSecurityTrace('CALL', { target: abstraction, result: displayResult });
                }
                return { value: result, churchSteps, pipeline, cycles: 7 };
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

        const num = parseFloat(expr);
        if (!isNaN(num)) {
            return { value: num, cycles: 0 };
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
        churchSteps.push(`${stepNum}. RETURN CR7                                ; Result = ${Number.isInteger(accumulator) ? accumulator : accumulator.toFixed(6)}`);

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
            'Boot': 0, 'Threads': 1, 'Lambda': 2, 'SlideRule': 3,
            'Abacus': 4, 'Constants': 5, 'Stack': 6,
            'SUCC': 7, 'PRED': 8, 'ADD': 9, 'SUB': 10,
            'MUL': 11, 'DIV': 12, 'POW': 13, 'SQRT': 14,
            'LOG': 15, 'EXP': 16, 'ISZERO': 17, 'LEQ': 18,
            'TRUE': 19, 'FALSE': 20, 'PAIR': 21, 'FST': 22, 'SND': 23,
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
                'Church Computer REPL \u2014 Pure Lambda Calculus',
                '',
                'Arithmetic:  3 + 5, 10 * 2, 8 / 4, 2 ^ 3',
                'Functions:   succ(n), pred(n), sqrt(x), log(x), exp(x)',
                'Variables:   let n = 4',
                '             let result = n * succ(n)',
                'Special:     ANS (last result), VARS (show all), CLEAR (reset)',
                '',
                'Pipeline modes:',
                '  Full (7-step):  LOAD \u2192 TPERM \u2192 CALL \u2192 LOAD \u2192 TPERM \u2192 LAMBDA \u2192 RETURN',
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
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChurchREPL;
}
