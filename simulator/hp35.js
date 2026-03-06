const hp35State = {
    stack: [0, 0, 0, 0],
    display: '0.',
    inputMode: false,
    hasDecimal: false,
    lastEntry: false,
    arcMode: false,
    trace: [],
    maxTrace: 50,
    rendered: false
};

function hp35TraceLog(lambdaExpr, desc) {
    hp35State.trace.unshift({ lambda: lambdaExpr, desc: desc, time: Date.now() });
    if (hp35State.trace.length > hp35State.maxTrace) hp35State.trace.pop();
}

function hp35StackLift() {
    hp35State.stack[3] = hp35State.stack[2];
    hp35State.stack[2] = hp35State.stack[1];
    hp35State.stack[1] = hp35State.stack[0];
}

function hp35StackDrop() {
    hp35State.stack[0] = hp35State.stack[1];
    hp35State.stack[1] = hp35State.stack[2];
    hp35State.stack[2] = hp35State.stack[3];
}

function hp35UpdateDisplay() {
    const val = hp35State.stack[0];
    if (hp35State.inputMode) {
        hp35State.display = hp35State.display;
    } else {
        if (val === 0) {
            hp35State.display = '0.';
        } else if (Math.abs(val) >= 1e10 || (Math.abs(val) < 0.001 && val !== 0)) {
            hp35State.display = val.toExponential(9).replace('e+', ' ').replace('e-', ' -').replace('e', ' ');
        } else {
            let s = val.toPrecision(10);
            if (s.indexOf('.') === -1) s += '.';
            hp35State.display = s;
        }
    }
    renderHP35Display();
}

function hp35PressDigit(d) {
    if (!hp35State.inputMode) {
        if (hp35State.lastEntry) {
            hp35State.lastEntry = false;
        } else {
            hp35StackLift();
        }
        hp35State.display = '';
        hp35State.inputMode = true;
        hp35State.hasDecimal = false;
    }
    if (d === '.' && hp35State.hasDecimal) return;
    if (d === '.') hp35State.hasDecimal = true;
    hp35State.display += d;
    hp35State.stack[0] = parseFloat(hp35State.display) || 0;

    const churchDigit = d === '.' ? 'DECIMAL' : `SUCC^${d}(ZERO)`;
    hp35TraceLog(`DIGIT(${churchDigit})`, `Key: ${d} \u2192 display "${hp35State.display}"`);
    hp35UpdateDisplay();
}

function hp35PressEnter() {
    hp35State.inputMode = false;
    hp35StackLift();
    hp35State.lastEntry = true;
    hp35TraceLog('PUSH X \u2192 PAIR(X, PAIR(Y, PAIR(Z, T)))', `ENTER: X=${hp35State.stack[0]} pushed, stack lifted`);
    hp35UpdateDisplay();
}

function hp35BinaryOp(name, fn, lambdaExpr) {
    hp35State.inputMode = false;
    const x = hp35State.stack[0];
    const y = hp35State.stack[1];
    const result = fn(y, x);
    if (!isFinite(result)) {
        hp35TraceLog(`${lambdaExpr}(${y}, ${x})`, `FAULT: ${name} \u2192 not finite`);
        return;
    }
    hp35StackDrop();
    hp35State.stack[0] = result;
    hp35TraceLog(`${lambdaExpr}(${y}, ${x}) = ${result}`, `${name}: ${y} ${name} ${x} = ${result}`);
    hp35UpdateDisplay();
}

function hp35UnaryOp(name, fn, lambdaExpr) {
    hp35State.inputMode = false;
    const x = hp35State.stack[0];
    const result = fn(x);
    if (!isFinite(result)) {
        hp35TraceLog(`${lambdaExpr}(${x})`, `FAULT: ${name} \u2192 not finite`);
        return;
    }
    hp35State.stack[0] = result;
    hp35TraceLog(`${lambdaExpr}(${x}) = ${result}`, `${name}: f(${x}) = ${result}`);
    hp35UpdateDisplay();
}

function hp35PressOp(op) {
    switch(op) {
        case '+': hp35BinaryOp('+', (a,b) => a+b, 'CHURCH_ADD'); break;
        case '-': hp35BinaryOp('-', (a,b) => a-b, 'CHURCH_SUB'); break;
        case '\u00d7': hp35BinaryOp('\u00d7', (a,b) => a*b, 'CHURCH_MUL'); break;
        case '\u00f7': hp35BinaryOp('\u00f7', (a,b) => b===0 ? Infinity : a/b, 'CHURCH_DIV'); break;
        case 'y\u02e3': hp35BinaryOp('y\u02e3', (a,b) => Math.pow(a,b), 'CHURCH_POW'); break;
        case '\u221ax': hp35UnaryOp('\u221ax', Math.sqrt, 'Y(\u03bbf.\u03bbg. IF(LEQ(MUL g g) x)(f(SUCC g))(PRED g)) 0'); break;
        case 'sin':
            if (hp35State.arcMode) {
                hp35UnaryOp('arcsin', Math.asin, 'ARC(SIN_TAYLOR)');
                hp35State.arcMode = false;
            } else {
                hp35UnaryOp('sin', Math.sin, 'SIN_TAYLOR(x - x\u00b3/3! + x\u2075/5! - ...)');
            }
            break;
        case 'cos':
            if (hp35State.arcMode) {
                hp35UnaryOp('arccos', Math.acos, 'ARC(COS_TAYLOR)');
                hp35State.arcMode = false;
            } else {
                hp35UnaryOp('cos', Math.cos, 'COS_TAYLOR(1 - x\u00b2/2! + x\u2074/4! - ...)');
            }
            break;
        case 'tan':
            if (hp35State.arcMode) {
                hp35UnaryOp('arctan', Math.atan, 'ARC(DIV(SIN,COS))');
                hp35State.arcMode = false;
            } else {
                hp35UnaryOp('tan', Math.tan, 'DIV(SIN_TAYLOR, COS_TAYLOR)');
            }
            break;
        case 'log': hp35UnaryOp('log\u2081\u2080', Math.log10, 'DIV(LN_SERIES(x), LN_SERIES(10))'); break;
        case 'ln': hp35UnaryOp('ln', Math.log, 'Y(\u03bbf.\u03bbx. LN_SERIES(x))'); break;
        case 'e\u02e3': hp35UnaryOp('e\u02e3', Math.exp, 'EXP_TAYLOR(1 + x + x\u00b2/2! + x\u00b3/3! + ...)'); break;
        case '1/x': hp35UnaryOp('1/x', x => x===0 ? Infinity : 1/x, 'CHURCH_DIV(SUCC ZERO, x)'); break;
        case 'x\u00b2': hp35UnaryOp('x\u00b2', x => x*x, 'CHURCH_MUL(x, x)'); break;
        case '\u03c0':
            hp35State.inputMode = false;
            hp35StackLift();
            hp35State.stack[0] = Math.PI;
            hp35TraceLog('CALL Constants(GT_PI) \u2192 DR0', `\u03c0 = ${Math.PI}`);
            hp35UpdateDisplay();
            break;
        case 'CHS':
            hp35State.stack[0] = -hp35State.stack[0];
            if (hp35State.inputMode && hp35State.display.startsWith('-')) {
                hp35State.display = hp35State.display.slice(1);
            } else if (hp35State.inputMode) {
                hp35State.display = '-' + hp35State.display;
            }
            hp35TraceLog('PAIR(NOT(FST sign), SND magnitude)', `CHS: ${-hp35State.stack[0]} \u2192 ${hp35State.stack[0]}`);
            hp35UpdateDisplay();
            break;
        case 'CLX':
            hp35State.stack[0] = 0;
            hp35State.display = '0.';
            hp35State.inputMode = false;
            hp35TraceLog('PAIR(ZERO, SND stack)', 'CLX: clear X register');
            hp35UpdateDisplay();
            break;
        case 'CLR':
            hp35State.stack = [0, 0, 0, 0];
            hp35State.display = '0.';
            hp35State.inputMode = false;
            hp35State.hasDecimal = false;
            hp35TraceLog('FALSE \u2014 empty stack', 'CLR: clear all registers');
            hp35UpdateDisplay();
            break;
        case 'x\u21c4y': {
            const tmp = hp35State.stack[0];
            hp35State.stack[0] = hp35State.stack[1];
            hp35State.stack[1] = tmp;
            hp35State.inputMode = false;
            hp35TraceLog('PAIR(FST(SND s))(PAIR(FST s)(SND(SND s)))', `SWAP: X=${hp35State.stack[0]}, Y=${hp35State.stack[1]}`);
            hp35UpdateDisplay();
            break;
        }
        case 'R\u2193': {
            const t0 = hp35State.stack[0];
            hp35State.stack[0] = hp35State.stack[1];
            hp35State.stack[1] = hp35State.stack[2];
            hp35State.stack[2] = hp35State.stack[3];
            hp35State.stack[3] = t0;
            hp35State.inputMode = false;
            hp35TraceLog('ROTATE_DOWN(stack)', `R\u2193: X=${hp35State.stack[0]} Y=${hp35State.stack[1]} Z=${hp35State.stack[2]} T=${hp35State.stack[3]}`);
            hp35UpdateDisplay();
            break;
        }
        case 'STO':
            hp35TraceLog('SAVE(X, LocalData)', `STO: stored ${hp35State.stack[0]}`);
            break;
        case 'RCL':
            hp35TraceLog('LOAD(LocalData) \u2192 X', `RCL: recalled value`);
            break;
        case 'EEX':
            hp35State.inputMode = false;
            hp35TraceLog('MUL(x, POW(10, e))', 'EEX: enter exponent mode');
            break;
        case 'ARC':
            hp35State.arcMode = !hp35State.arcMode;
            hp35TraceLog('TOGGLE(arc_mode)', `ARC: ${hp35State.arcMode ? 'ON' : 'OFF'} \u2014 next trig uses inverse`);
            renderHP35Display();
            break;
    }
}

function renderHP35Display() {
    const container = document.getElementById('hp35Container');
    if (!container) return;

    const displayEl = container.querySelector('.hp35-screen-value');
    if (displayEl) displayEl.textContent = hp35State.display;

    const arcIndicator = container.querySelector('.hp35-arc-indicator');
    if (arcIndicator) arcIndicator.style.visibility = hp35State.arcMode ? 'visible' : 'hidden';

    for (let i = 0; i < 4; i++) {
        const el = container.querySelector(`.hp35-stack-reg[data-reg="${i}"]`);
        if (el) {
            const labels = ['X','Y','Z','T'];
            const val = hp35State.stack[i];
            let valStr;
            if (i === 0 && hp35State.inputMode) {
                valStr = hp35State.display;
            } else if (Math.abs(val) >= 1e10 || (Math.abs(val) < 0.001 && val !== 0)) {
                valStr = val.toExponential(6);
            } else {
                valStr = val.toPrecision(10);
            }
            el.innerHTML = `<span class="hp35-reg-label">${labels[i]}:</span> <span class="hp35-reg-value">${valStr}</span>`;
        }
    }

    const traceEl = container.querySelector('.hp35-trace-area');
    if (traceEl) {
        let traceHtml = '';
        hp35State.trace.forEach((t, idx) => {
            traceHtml += `<div class="hp35-trace-entry ${idx === 0 ? 'hp35-trace-latest' : ''}">`;
            traceHtml += `<div class="hp35-trace-lambda">${t.lambda}</div>`;
            traceHtml += `<div class="hp35-trace-desc">${t.desc}</div>`;
            traceHtml += '</div>';
        });
        traceEl.innerHTML = traceHtml;
    }
}

function renderHP35Calculator() {
    const container = document.getElementById('hp35Container');
    if (!container) return;

    container.innerHTML = `
        <div class="hp35-calc-wrapper">
            <div class="hp35-body">
                <div class="hp35-brand">
                    <span class="hp35-hp-logo">HEWLETT \u00b7 PACKARD</span>
                    <span class="hp35-model">35</span>
                </div>
                <div class="hp35-screen">
                    <div class="hp35-arc-indicator" style="visibility:hidden">ARC</div>
                    <div class="hp35-screen-value">${hp35State.display}</div>
                </div>
                <div class="hp35-keys">
                    <div class="hp35-key-row">
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('x\u00b2')">x\u00b2</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('\u221ax')">\u221ax</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('e\u02e3')">e\u02e3</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('log')">LOG</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('ln')">LN</button>
                    </div>
                    <div class="hp35-key-row">
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('ARC')">ARC</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('sin')">SIN</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('cos')">COS</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('tan')">TAN</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('1/x')">1/x</button>
                    </div>
                    <div class="hp35-key-row">
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('x\u21c4y')">x\u21c4y</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('R\u2193')">R\u2193</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('STO')">STO</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('RCL')">RCL</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('y\u02e3')">y\u02e3</button>
                    </div>
                    <div class="hp35-key-row">
                        <button class="hp35-key hp35-key-enter" onclick="hp35PressEnter()">ENTER \u2191</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('CHS')">CHS</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('EEX')">EEX</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('CLX')">CLX</button>
                    </div>
                    <div class="hp35-key-row">
                        <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('7')">7</button>
                        <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('8')">8</button>
                        <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('9')">9</button>
                        <button class="hp35-key hp35-key-op" onclick="hp35PressOp('+')">+</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('\u03c0')">\u03c0</button>
                    </div>
                    <div class="hp35-key-row">
                        <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('4')">4</button>
                        <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('5')">5</button>
                        <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('6')">6</button>
                        <button class="hp35-key hp35-key-op" onclick="hp35PressOp('-')">\u2212</button>
                        <button class="hp35-key hp35-key-fn" onclick="hp35PressOp('CLR')">CLR</button>
                    </div>
                    <div class="hp35-key-row">
                        <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('1')">1</button>
                        <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('2')">2</button>
                        <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('3')">3</button>
                        <button class="hp35-key hp35-key-op" onclick="hp35PressOp('\u00d7')">\u00d7</button>
                        <button class="hp35-key" style="visibility:hidden"></button>
                    </div>
                    <div class="hp35-key-row">
                        <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('0')">0</button>
                        <button class="hp35-key hp35-key-digit" onclick="hp35PressDigit('.')">.</button>
                        <button class="hp35-key" style="visibility:hidden"></button>
                        <button class="hp35-key hp35-key-op" onclick="hp35PressOp('\u00f7')">\u00f7</button>
                        <button class="hp35-key" style="visibility:hidden"></button>
                    </div>
                </div>
            </div>
            <div class="hp35-stack-display">
                <div class="hp35-stack-header">4-Register Stack</div>
                <div class="hp35-stack-reg" data-reg="3"></div>
                <div class="hp35-stack-reg" data-reg="2"></div>
                <div class="hp35-stack-reg" data-reg="1"></div>
                <div class="hp35-stack-reg" data-reg="0"></div>
            </div>
            <div class="hp35-trace-inline">
                <div class="hp35-trace-header">Lambda Calculus Trace</div>
                <div class="hp35-trace-area"></div>
            </div>
        </div>
    `;

    hp35State.rendered = true;
    hp35UpdateDisplay();
}
