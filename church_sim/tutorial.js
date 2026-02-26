class BernoulliTutorial {
    constructor(repl, pipeline) {
        this.repl = repl;
        this.pipeline = pipeline;
        this.currentStep = -1;
        this.results = [];
        this.running = false;
        this.totalCycles = { full: 0, fused: 0, chained: 0 };

        this.steps = [
            {
                title: "Ada Lovelace's Bernoulli Computation",
                description: "Ada's Note G (1843) computed Bernoulli numbers step by step. We compute 1\u00b2 + 2\u00b2 + 3\u00b2 + 4\u00b2 = 30 using n(n+1)(2n+1)/6 where n=4. Watch how the pipeline shrinks as we discover optimizations.",
                code: null,
                isIntro: true,
                phase: 1,
            },

            {
                title: "Phase 1: Full 7-Step Pipeline",
                description: "Every operation passes through all 7 security gates: LOAD \u2192 TPERM(E) \u2192 CALL \u2192 LOAD \u2192 TPERM(X) \u2192 LAMBDA \u2192 RETURN. This is the foundation \u2014 understand every gate before we optimize.",
                code: null,
                isPhaseIntro: true,
                phase: 1,
                pipelineMode: 'full',
            },
            {
                title: "Step 1: Set n = 4",
                description: "Using Church successor: succ(3) = 4. All 7 security gates fire for this single operation.",
                code: "let n = succ(3)",
                expected: 4,
                phase: 1,
                pipelineMode: 'full',
            },
            {
                title: "Step 2: Define two",
                description: "two = succ(1) = 2. Another 7 cycles \u2014 every operation costs the same.",
                code: "let two = succ(1)",
                expected: 2,
                phase: 1,
                pipelineMode: 'full',
            },
            {
                title: "Step 3: Compute n+1",
                description: "n+1 = succ(4) = 5. The successor function: \u03bbf.\u03bbx.f(n f x).",
                code: "let n_plus_1 = succ(n)",
                expected: 5,
                phase: 1,
                pipelineMode: 'full',
            },
            {
                title: "Step 4: Compute 2n",
                description: "2 \u00d7 4 = 8. Multiplication via Church numerals: \u03bbm.\u03bbn.\u03bbf.m(n f).",
                code: "let two_n = two * n",
                expected: 8,
                phase: 1,
                pipelineMode: 'full',
            },
            {
                title: "Step 5: Compute 2n+1",
                description: "succ(8) = 9. Building the formula piece by piece, Ada's way.",
                code: "let two_n_plus_1 = succ(two_n)",
                expected: 9,
                phase: 1,
                pipelineMode: 'full',
            },
            {
                title: "Step 6: n \u00d7 (n+1)",
                description: "4 \u00d7 5 = 20. Each multiplication: 7 cycles through the pipeline.",
                code: "let prod1 = n * n_plus_1",
                expected: 20,
                phase: 1,
                pipelineMode: 'full',
            },
            {
                title: "Step 7: Complete numerator",
                description: "20 \u00d7 9 = 180. We now have n(n+1)(2n+1).",
                code: "let product = prod1 * two_n_plus_1",
                expected: 180,
                phase: 1,
                pipelineMode: 'full',
            },
            {
                title: "Step 8: Compute divisor",
                description: "2 \u00d7 3 = 6.",
                code: "let six = two * 3",
                expected: 6,
                phase: 1,
                pipelineMode: 'full',
            },
            {
                title: "Step 9: Formula result",
                description: "180 \u00f7 6 = 30. Nine operations \u00d7 7 cycles = 63 cycles total. Can we do better?",
                code: "let sum_of_squares = product / six",
                expected: 30,
                phase: 1,
                pipelineMode: 'full',
            },
            {
                title: "Phase 1 Complete: 63 cycles",
                description: "9 operations \u00d7 7 cycles each = 63 cycles. Every gate fired on every operation \u2014 security is airtight. But notice: LOAD+TPERM+CALL always happen together, and LOAD+TPERM+LAMBDA always happen together. What if we fused them?",
                code: null,
                isPhaseConclusion: true,
                phase: 1,
                fullCycles: 63,
            },

            {
                title: "Phase 2: Fused Instructions",
                description: "ELOADCALL = LOAD + TPERM(E) + CALL in one instruction. XLOADLAMBDA = LOAD + TPERM(X) + LAMBDA in one instruction. Same security checks, 3 cycles instead of 7.",
                code: null,
                isPhaseIntro: true,
                phase: 2,
                pipelineMode: 'fused',
            },
            {
                title: "Fused Step 1: Set n = 4",
                description: "succ(3) = 4. Now just 3 cycles: ELOADCALL \u2192 XLOADLAMBDA \u2192 RETURN.",
                code: "let n = succ(3)",
                expected: 4,
                phase: 2,
                pipelineMode: 'fused',
            },
            {
                title: "Fused Step 2: two = 2",
                description: "succ(1) = 2. Same result, 57% fewer cycles.",
                code: "let two = succ(1)",
                expected: 2,
                phase: 2,
                pipelineMode: 'fused',
            },
            {
                title: "Fused Step 3: n+1 = 5",
                description: "succ(4) = 5. Every TPERM check still fires inside the fused instruction.",
                code: "let n_plus_1 = succ(n)",
                expected: 5,
                phase: 2,
                pipelineMode: 'fused',
            },
            {
                title: "Fused Step 4: 2n = 8",
                description: "two * n = 8. The security is identical \u2014 just fewer decode cycles.",
                code: "let two_n = two * n",
                expected: 8,
                phase: 2,
                pipelineMode: 'fused',
            },
            {
                title: "Fused Step 5: 2n+1 = 9",
                description: "succ(8) = 9.",
                code: "let two_n_plus_1 = succ(two_n)",
                expected: 9,
                phase: 2,
                pipelineMode: 'fused',
            },
            {
                title: "Fused Step 6: n(n+1) = 20",
                description: "4 \u00d7 5 = 20.",
                code: "let prod1 = n * n_plus_1",
                expected: 20,
                phase: 2,
                pipelineMode: 'fused',
            },
            {
                title: "Fused Step 7: Numerator = 180",
                description: "20 \u00d7 9 = 180.",
                code: "let product = prod1 * two_n_plus_1",
                expected: 180,
                phase: 2,
                pipelineMode: 'fused',
            },
            {
                title: "Fused Step 8: Divisor = 6",
                description: "two * 3 = 6.",
                code: "let six = two * 3",
                expected: 6,
                phase: 2,
                pipelineMode: 'fused',
            },
            {
                title: "Fused Step 9: Result = 30",
                description: "180 / 6 = 30. Nine operations \u00d7 3 cycles = 27 cycles. Down from 63!",
                code: "let sum_of_squares = product / six",
                expected: 30,
                phase: 2,
                pipelineMode: 'fused',
            },
            {
                title: "Phase 2 Complete: 27 cycles",
                description: "9 operations \u00d7 3 cycles = 27 cycles (was 63 \u2014 57% reduction). But we're still entering and leaving SlideRule 6 times for 6 math operations. What if SlideRule could accept a whole program of methods at once?",
                code: null,
                isPhaseConclusion: true,
                phase: 2,
                fusedCycles: 27,
            },

            {
                title: "Phase 3: Programmable Abstractions",
                description: "Send the entire method sequence as a program: \"SUCC,SUCC,MUL,SUCC,MUL,MUL,MUL,DIV\". One ELOADCALL enters the scope, each method gets its own XLOADLAMBDA with TPERM(X) check, one RETURN at the end.",
                code: null,
                isPhaseIntro: true,
                phase: 3,
                pipelineMode: 'chained',
            },
            {
                title: "Chained: Complete formula in one call",
                description: "n(n+1)(2n+1)/6 with n=4. The method sequence programs SlideRule to compute: start with 3, SUCC\u21924, SUCC\u21925, MUL\u219220, then 2n+1=9 path and final division. All inside one protected scope.",
                code: null,
                isChainDemo: true,
                phase: 3,
                pipelineMode: 'chained',
                chainAbstraction: 'SlideRule',
                chainMethods: ['SUCC', 'MUL', 'SUCC', 'MUL', 'SUCC', 'MUL', 'MUL', 'DIV'],
                chainArgs: [3, null, 1, null, null, null, null, 6],
                chainDescription: "n=succ(3)=4, n*1=4, n_plus_1=succ(4)=5, n*(n+1)=20, two_n_plus_1=succ(8)=9, 20*9=180, 180/6=30",
            },
            {
                title: "Phase 3 Complete: 10 cycles",
                description: "1 ELOADCALL + 8 XLOADLAMBDA + 1 RETURN = 10 cycles. The abstraction executed 8 methods in one call. Same result (30), same security (every XLOADLAMBDA checks X permission), but 84% fewer cycles than the original 63.",
                code: null,
                isPhaseConclusion: true,
                phase: 3,
                chainedCycles: 10,
            },

            {
                title: "Phase 4: The Discovery Path",
                description: null,
                code: null,
                isComparison: true,
                phase: 4,
            },
        ];
    }

    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let html = '<div class="tutorial-wrapper">';

        html += '<div class="tutorial-header">';
        html += '<h2>The Discovery Path: From 7 Gates to Programmable Abstractions</h2>';
        html += '<p class="tutorial-tagline">Pure Lambda Calculus \u2022 Zero Turing Instructions \u2022 Progressive Optimization</p>';
        html += '<div class="tutorial-controls">';
        html += `<button class="btn btn-tutorial" onclick="churchTutorial.stepBack()" ${this.currentStep <= 0 ? 'disabled' : ''}>\u25C0 Back</button>`;
        html += `<span class="tutorial-progress">${Math.max(0, this.currentStep + 1)} / ${this.steps.length}</span>`;
        html += `<button class="btn btn-tutorial" onclick="churchTutorial.stepForward()">${this.currentStep >= this.steps.length - 1 ? 'Reset' : 'Next \u25B6'}</button>`;
        html += `<button class="btn btn-tutorial btn-run-all" onclick="churchTutorial.runAll()">Run All</button>`;
        html += '</div>';

        const currentPhase = this.currentStep >= 0 && this.currentStep < this.steps.length ? this.steps[this.currentStep].phase : 0;
        html += '<div class="tutorial-phase-indicators">';
        for (let p = 1; p <= 4; p++) {
            const cls = p < currentPhase ? 'phase-done' : p === currentPhase ? 'phase-active' : 'phase-pending';
            const labels = ['', '7-Step', '3-Step Fused', 'Chained', 'Comparison'];
            html += `<div class="phase-indicator ${cls}"><span class="phase-num">${p}</span><span class="phase-label">${labels[p]}</span></div>`;
            if (p < 4) html += '<div class="phase-connector"></div>';
        }
        html += '</div>';

        html += '</div>';

        html += '<div class="tutorial-body">';

        html += '<div class="tutorial-step-panel">';
        if (this.currentStep >= 0 && this.currentStep < this.steps.length) {
            const step = this.steps[this.currentStep];

            if (step.isComparison) {
                html += this._renderComparison();
            } else {
                html += `<div class="tutorial-step-title">${step.title}</div>`;
                if (step.description) {
                    html += `<div class="tutorial-step-desc">${step.description}</div>`;
                }
                if (step.code) {
                    html += `<div class="tutorial-code"><code>${this._escapeHtml(step.code)}</code></div>`;
                }
                if (step.isChainDemo) {
                    html += this._renderChainDemo(step);
                }
                if (this.results[this.currentStep]) {
                    const r = this.results[this.currentStep];
                    if (r.type === 'result') {
                        html += `<div class="tutorial-result">${this._escapeHtml(r.text)}</div>`;
                        if (r.cycles !== undefined) {
                            html += `<div class="tutorial-cycles">Cycles: ${r.cycles}</div>`;
                        }
                        if (r.churchSteps && r.churchSteps.length > 0) {
                            html += '<div class="tutorial-pipeline-trace">';
                            html += '<div class="trace-title">Security Pipeline Trace:</div>';
                            for (const s of r.churchSteps) {
                                html += `<div class="trace-step">${this._escapeHtml(s)}</div>`;
                            }
                            html += '</div>';
                        }
                    } else if (r.type === 'error') {
                        html += `<div class="tutorial-error">${this._escapeHtml(r.text)}</div>`;
                    }
                }
                if (step.isPhaseConclusion) {
                    html += this._renderPhaseSummary(step);
                }
            }
        } else if (this.currentStep < 0) {
            html += '<div class="tutorial-step-title">Welcome</div>';
            html += '<div class="tutorial-step-desc">Click "Next" to begin the Discovery Path \u2014 from the full 7-gate security pipeline to programmable abstractions, following the exact reasoning that led to each optimization.</div>';
            html += '<div style="margin-top:1rem;padding:0.8rem 1rem;background:#1a1a2a;border:1px solid #d4a843;border-radius:6px;font-size:0.8rem;color:#c9d1d9;line-height:1.5;">';
            html += '<span style="color:#d4a843;font-weight:600;">Pages button</span> &mdash; The gold <em>Pages</em> button in the navigation bar opens the Page Directory: a single page listing every simulator, reference document, architecture figure, and business document in the project. Use it to jump directly to any page.';
            html += '</div>';
        }
        html += '</div>';

        html += '<div class="tutorial-vars-panel">';
        html += '<div class="vars-title">Named Values (Ada\'s Style)</div>';
        if (this.repl && Object.keys(this.repl.variables).length > 0) {
            for (const [name, val] of Object.entries(this.repl.variables)) {
                const displayVal = Number.isInteger(val) ? val : val.toFixed(6);
                const isHighlight = this.results[this.currentStep] && this.results[this.currentStep].variable === name;
                html += `<div class="var-entry ${isHighlight ? 'var-highlight' : ''}">`;
                html += `<span class="var-name">${name}</span>`;
                html += `<span class="var-value">${displayVal}</span>`;
                html += '</div>';
            }
        } else {
            html += '<div class="vars-empty">No values yet \u2014 step through to compute</div>';
        }
        html += '</div>';

        html += '</div>';
        html += '</div>';

        container.innerHTML = html;
    }

    _renderChainDemo(step) {
        let html = '<div class="chain-demo">';
        html += `<div class="chain-label">Method Sequence Program:</div>`;
        html += `<div class="chain-sequence">"${step.chainMethods.join(',')}"</div>`;
        html += '<div class="chain-flow">';

        html += '<div class="chain-step chain-entry">ELOADCALL \u2192 SlideRule</div>';
        for (let i = 0; i < step.chainMethods.length; i++) {
            html += `<div class="chain-step chain-method">XLOADLAMBDA: ${step.chainMethods[i]}</div>`;
        }
        html += '<div class="chain-step chain-exit">RETURN \u2192 result</div>';

        html += '</div>';
        html += `<div class="chain-cycles">Total: 1 + ${step.chainMethods.length} + 1 = ${step.chainMethods.length + 2} cycles</div>`;
        html += '</div>';

        if (this.results[this.currentStep]) {
            const r = this.results[this.currentStep];
            if (r.churchSteps && r.churchSteps.length > 0) {
                html += '<div class="tutorial-pipeline-trace">';
                html += '<div class="trace-title">Execution Trace:</div>';
                for (const s of r.churchSteps) {
                    html += `<div class="trace-step">${this._escapeHtml(s)}</div>`;
                }
                html += '</div>';
            }
        }

        return html;
    }

    _renderPhaseSummary(step) {
        let html = '<div class="phase-summary">';
        if (step.fullCycles) {
            html += `<div class="summary-stat"><span class="stat-label">Total cycles:</span><span class="stat-value">${step.fullCycles}</span></div>`;
            html += `<div class="summary-stat"><span class="stat-label">Per operation:</span><span class="stat-value">7 cycles</span></div>`;
        }
        if (step.fusedCycles) {
            html += `<div class="summary-stat"><span class="stat-label">Fused cycles:</span><span class="stat-value">${step.fusedCycles}</span></div>`;
            html += `<div class="summary-stat"><span class="stat-label">Reduction:</span><span class="stat-value">57% (from 63)</span></div>`;
        }
        if (step.chainedCycles) {
            html += `<div class="summary-stat"><span class="stat-label">Chained cycles:</span><span class="stat-value">${step.chainedCycles}</span></div>`;
            html += `<div class="summary-stat"><span class="stat-label">Reduction:</span><span class="stat-value">84% (from 63)</span></div>`;
        }
        html += '</div>';
        return html;
    }

    _renderComparison() {
        let html = '<div class="tutorial-step-title">The Discovery Path: Side by Side</div>';
        html += '<div class="tutorial-step-desc">Same computation (1\u00b2+2\u00b2+3\u00b2+4\u00b2=30), same security, dramatically fewer cycles.</div>';

        html += '<div class="comparison-table">';
        html += '<div class="comparison-row comparison-header">';
        html += '<div class="comp-col">Phase</div>';
        html += '<div class="comp-col">Method</div>';
        html += '<div class="comp-col">Cycles</div>';
        html += '<div class="comp-col">Reduction</div>';
        html += '</div>';

        html += '<div class="comparison-row phase-1-row">';
        html += '<div class="comp-col comp-phase">1</div>';
        html += '<div class="comp-col">7-Step Pipeline</div>';
        html += '<div class="comp-col comp-cycles">63</div>';
        html += '<div class="comp-col">\u2014</div>';
        html += '</div>';

        html += '<div class="comparison-row phase-2-row">';
        html += '<div class="comp-col comp-phase">2</div>';
        html += '<div class="comp-col">Fused (ELOADCALL + XLOADLAMBDA)</div>';
        html += '<div class="comp-col comp-cycles">27</div>';
        html += '<div class="comp-col comp-reduction">57%</div>';
        html += '</div>';

        html += '<div class="comparison-row phase-3-row">';
        html += '<div class="comp-col comp-phase">3</div>';
        html += '<div class="comp-col">Programmable Abstraction Chain</div>';
        html += '<div class="comp-col comp-cycles">10</div>';
        html += '<div class="comp-col comp-reduction">84%</div>';
        html += '</div>';
        html += '</div>';

        html += '<div class="comparison-insight">';
        html += '<div class="insight-title">The Key Insight</div>';
        html += '<div class="insight-text">Each optimization preserves every security check. The abstraction became programmable \u2014 it receives a method sequence and executes it within one protected scope. The capability model constrains what methods the caller can name. Security is the architecture, not overhead.</div>';
        html += '</div>';

        html += '<div class="comparison-bars">';
        html += '<div class="bar-row"><span class="bar-label">Phase 1</span><div class="bar-track"><div class="bar-fill bar-phase1" style="width:100%">63 cycles</div></div></div>';
        html += '<div class="bar-row"><span class="bar-label">Phase 2</span><div class="bar-track"><div class="bar-fill bar-phase2" style="width:42.8%">27 cycles</div></div></div>';
        html += '<div class="bar-row"><span class="bar-label">Phase 3</span><div class="bar-track"><div class="bar-fill bar-phase3" style="width:15.9%">10 cycles</div></div></div>';
        html += '</div>';

        return html;
    }

    stepForward() {
        if (this.currentStep >= this.steps.length - 1) {
            this.reset();
            return;
        }

        this.currentStep++;
        const step = this.steps[this.currentStep];

        if (step.pipelineMode && this.repl) {
            this.repl.setPipelineMode(step.pipelineMode);
            if (this.pipeline) {
                this.pipeline._setMode(step.pipelineMode);
            }
        }

        if (step.isPhaseIntro && step.phase === 2) {
            if (this.repl) this.repl._clear();
        }

        if (step.code && this.repl) {
            const result = this.repl.execute(step.code);
            this.results[this.currentStep] = result;

            if (result && result.pipeline && this.pipeline) {
                this.pipeline.showFullPipeline(result.pipeline);
            }
        }

        if (step.isChainDemo && this.repl) {
            const result = this.repl.executeChain(
                step.chainAbstraction,
                step.chainMethods,
                step.chainArgs
            );
            this.results[this.currentStep] = {
                type: 'result',
                text: `sum_of_squares = ${Number.isInteger(result.value) ? result.value : result.value.toFixed(6)}`,
                value: result.value,
                churchSteps: result.churchSteps,
                pipeline: result.pipeline,
                cycles: result.cycles,
                variable: 'sum_of_squares',
            };
            if (this.repl) {
                this.repl.variables['sum_of_squares'] = result.value;
                this.repl.ans = result.value;
            }
            if (result.pipeline && this.pipeline) {
                this.pipeline.showChainedPipeline(step.chainMethods, result.pipeline);
            }
        }

        this.render('tutorialView');
    }

    stepBack() {
        if (this.currentStep <= 0) return;

        if (this.repl) {
            this.repl._clear();
            this.repl.setPipelineMode('full');
            this.results = [];

            for (let i = 0; i <= this.currentStep - 1; i++) {
                const s = this.steps[i];
                if (s.pipelineMode) {
                    this.repl.setPipelineMode(s.pipelineMode);
                }
                if (s.isPhaseIntro && s.phase === 2) {
                    this.repl._clear();
                }
                if (s.code) {
                    const r = this.repl.execute(s.code);
                    this.results[i] = r;
                }
                if (s.isChainDemo) {
                    const r = this.repl.executeChain(s.chainAbstraction, s.chainMethods, s.chainArgs);
                    this.results[i] = {
                        type: 'result',
                        text: `sum_of_squares = ${Number.isInteger(r.value) ? r.value : r.value.toFixed(6)}`,
                        value: r.value,
                        churchSteps: r.churchSteps,
                        pipeline: r.pipeline,
                        cycles: r.cycles,
                        variable: 'sum_of_squares',
                    };
                    this.repl.variables['sum_of_squares'] = r.value;
                }
            }
        }

        this.currentStep--;
        this.render('tutorialView');
    }

    async runAll() {
        if (this.running) return;
        this.running = true;
        this.reset();

        for (let i = 0; i < this.steps.length; i++) {
            this.currentStep = i;
            const step = this.steps[i];

            if (step.pipelineMode && this.repl) {
                this.repl.setPipelineMode(step.pipelineMode);
                if (this.pipeline) {
                    this.pipeline._setMode(step.pipelineMode);
                }
            }

            if (step.isPhaseIntro && step.phase === 2 && this.repl) {
                this.repl._clear();
            }

            if (step.code && this.repl) {
                const result = this.repl.execute(step.code);
                this.results[i] = result;

                if (result && result.pipeline && this.pipeline) {
                    await this.pipeline.animate(result.pipeline, 100);
                }
            }

            if (step.isChainDemo && this.repl) {
                const result = this.repl.executeChain(step.chainAbstraction, step.chainMethods, step.chainArgs);
                this.results[i] = {
                    type: 'result',
                    text: `sum_of_squares = ${Number.isInteger(result.value) ? result.value : result.value.toFixed(6)}`,
                    value: result.value,
                    churchSteps: result.churchSteps,
                    pipeline: result.pipeline,
                    cycles: result.cycles,
                    variable: 'sum_of_squares',
                };
                this.repl.variables['sum_of_squares'] = result.value;
                if (result.pipeline && this.pipeline) {
                    this.pipeline.showChainedPipeline(step.chainMethods, result.pipeline);
                }
            }

            this.render('tutorialView');
            await new Promise(r => setTimeout(r, 200));
        }

        this.running = false;
    }

    reset() {
        this.currentStep = -1;
        this.results = [];
        if (this.repl) {
            this.repl._clear();
            this.repl.setPipelineMode('full');
        }
        if (this.pipeline) {
            this.pipeline._setMode('full');
            this.pipeline.reset();
        }
        this.render('tutorialView');
    }

    _escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BernoulliTutorial;
}
