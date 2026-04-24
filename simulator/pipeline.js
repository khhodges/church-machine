class PipelineVisualizer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.mode = 'full';
        this.stages = [];
        this.currentStage = -1;
        this.animating = false;
        this.stageData = [];
        this.chainSteps = [];
        this.niaRows = null;
        this._setMode('audit');
    }

    setNIA(rows) {
        this.niaRows = (rows && rows.curr) ? rows : null;
    }

    setNIAProvider(fn) {
        this.niaProvider = fn;
    }

    setCallHomeStatusProvider(fn) {
        this.callHomeStatusProvider = fn;
    }

    _renderNIA() {
        let niaData = this.niaRows;
        if (!niaData && this.niaProvider) {
            try { niaData = this.niaProvider(); } catch(e) { niaData = null; }
        }
        if (!niaData || !niaData.curr) return '';

        // Full boot-sequence overview — show all steps as a checklist with current highlighted
        if (niaData.all && niaData.currIdx !== undefined) {
            const steps = niaData.all;
            const ci    = niaData.currIdx;
            let html = '<div class="nia-boot-table">';
            html += '<div class="nia-boot-title">Boot Sequence</div>';
            html += '<table class="nia-table nia-boot-full">';
            for (let i = 0; i < steps.length; i++) {
                const d = steps[i];
                const done    = i < ci;
                const current = i === ci;
                const rowCls  = current ? 'nia-row-curr' : (done ? 'nia-row-done' : 'nia-row-next');
                const icon    = done ? '\u2713' : (current ? '\u25b6' : '\u00b7');
                const loc     = d.label ? (d.label + (d.offset > 0 ? `+${d.offset}` : '')) : (d.prog || '');
                html += `<tr class="${rowCls}">`;
                html += `<td class="nia-boot-icon">${icon}</td>`;
                html += `<td class="nia-addr"><code>${d.addrStr || ''}</code></td>`;
                html += `<td class="nia-disasm"><code>${d.disasm || ''}</code></td>`;
                html += `<td class="nia-loc">${loc ? `<span class="nia-loc-text">${loc}</span>` : ''}</td>`;
                html += '</tr>';
            }
            html += '</table>';
            const callHomeStatus = this.callHomeStatusProvider ? this.callHomeStatusProvider() : null;
            if (callHomeStatus) {
                const isOnline = callHomeStatus === 'online';
                html += `<div class="nia-ide-badge-row"><span class="nia-ide-badge ${isOnline ? 'nia-ide-online' : 'nia-ide-offline'}">IDE: ${callHomeStatus}</span></div>`;
            }
            html += '</div>';
            return html;
        }

        // Normal 3-row NIA (last / this / next)
        const rows = [
            { key: 'last', label: 'last',               data: niaData.last },
            { key: 'curr', label: '\u25b6\u202fthis',   data: niaData.curr },
            { key: 'next', label: 'next',               data: niaData.next }
        ];
        let html = '<table class="nia-table">';
        for (const row of rows) {
            const d = row.data;
            const rowClass = `nia-row-${row.key}`;
            const addrStr  = d ? (d.addrStr || ('0x' + d.addr.toString(16).toUpperCase().padStart(4, '0'))) : '\u2014';
            const disasm   = d ? (d.disasm || '\u2014') : '\u2014';
            const loc      = d ? (d.label ? (d.label + (d.offset > 0 ? `+${d.offset}` : '')) : (d.prog || '')) : '\u2014';
            html += `<tr class="${rowClass}">`;
            html += `<td class="nia-lbl">${row.label}</td>`;
            html += `<td class="nia-addr"><code>${addrStr}</code></td>`;
            html += `<td class="nia-disasm"><code>${disasm}</code></td>`;
            html += `<td class="nia-loc">${loc ? `<span class="nia-loc-text">${loc}</span>` : ''}</td>`;
            html += `</tr>`;
        }
        html += '</table>';
        const callHomeStatus = this.callHomeStatusProvider ? this.callHomeStatusProvider() : null;
        if (callHomeStatus) {
            const isOnline = callHomeStatus === 'online';
            html += `<div class="nia-ide-badge-row"><span class="nia-ide-badge ${isOnline ? 'nia-ide-online' : 'nia-ide-offline'}">IDE: ${callHomeStatus}</span></div>`;
        }
        return html;
    }

    _setMode(mode) {
        this.mode = mode;
        switch (mode) {
            case 'full':
                this.stages = [
                    { id: 'load1',  label: 'LOAD',   desc: 'Namespace lookup (L permission)' },
                    { id: 'tperm1', label: 'TPERM',  desc: 'Verify entry permission (E)' },
                    { id: 'call',   label: 'CALL',   desc: 'Enter scope, save context' },
                    { id: 'load2',  label: 'LOAD',   desc: 'C-List slot lookup (L permission)' },
                    { id: 'tperm2', label: 'TPERM',  desc: 'Verify execute permission (X)' },
                    { id: 'lambda', label: 'LAMBDA', desc: 'Church reduction' },
                    { id: 'return', label: 'RETURN', desc: 'Restore scope, return result' },
                ];
                break;
            case 'fused':
                this.stages = [
                    { id: 'eloadcall',   label: 'ELOADCALL',   desc: 'LOAD + TPERM(E) + CALL — fused entry', fused: true, subSteps: ['LOAD (L)', 'TPERM (E)', 'CALL'] },
                    { id: 'xloadlambda', label: 'XLOADLAMBDA', desc: 'LOAD + TPERM(X) + LAMBDA — fused execute', fused: true, subSteps: ['LOAD (L)', 'TPERM (X)', 'LAMBDA'] },
                    { id: 'return',      label: 'RETURN',      desc: 'Restore scope, return result' },
                ];
                break;
            case 'chained':
                this.stages = [
                    { id: 'eloadcall', label: 'ELOADCALL', desc: 'Enter programmable abstraction', fused: true, subSteps: ['LOAD (L)', 'TPERM (E)', 'CALL'] },
                ];
                break;
            case 'audit':
                this.stages = [];
                break;
        }
    }

    render() {
        if (!this.container) return;

        if (this.mode === 'audit') {
            this._renderAudit();
            return;
        }

        const modeLabels = { full: '7-Step Security Pipeline', fused: '3-Step Fused Pipeline', chained: 'Programmable Abstraction Chain' };
        const modeDescs = {
            full: 'Every operation passes through all 7 gates',
            fused: 'ELOADCALL + XLOADLAMBDA + RETURN — same security, 57% fewer cycles',
            chained: 'Single CALL, method sequence executes internally — 81% fewer cycles'
        };

        let html = '<div class="pipeline-wrapper">';

        html += '<div class="pipeline-mode-selector">';
        for (const m of ['full', 'fused', 'chained', 'audit']) {
            const btnLabel = { full: '7-Step', fused: '3-Step Fused', chained: 'Chained', audit: 'TSB Audit' }[m];
            html += `<button class="btn btn-mode ${this.mode === m ? 'active' : ''}" onclick="setPipelineMode('${m}')">${btnLabel}</button>`;
        }
        html += '</div>';

        html += `<div class="pipeline-title">${modeLabels[this.mode]}</div>`;
        html += `<div class="pipeline-subtitle">${modeDescs[this.mode]}</div>`;
        html += this._renderNIA();
        html += '<div class="pipeline-stages">';

        const displayStages = [...this.stages];
        if (this.mode === 'chained' && this.chainSteps.length > 0) {
            for (let i = 0; i < this.chainSteps.length; i++) {
                displayStages.push({
                    id: `chain_${i}`,
                    label: 'XLOADLAMBDA',
                    desc: `Method: ${this.chainSteps[i]}`,
                    fused: true,
                    subSteps: ['LOAD (L)', 'TPERM (X)', `LAMBDA (${this.chainSteps[i]})`],
                    chainIndex: i,
                });
            }
            displayStages.push({ id: 'return', label: 'RETURN', desc: 'Restore scope, return result' });
        }

        for (let i = 0; i < displayStages.length; i++) {
            const s = displayStages[i];
            const stateClass = i < this.currentStage ? 'stage-done' :
                              i === this.currentStage ? 'stage-active' : 'stage-pending';
            const data = this.stageData[i] || {};

            html += `<div class="pipeline-stage ${stateClass} ${s.fused ? 'stage-fused' : ''}" id="pipe-stage-${i}">`;
            html += `<div class="stage-number">${i + 1}</div>`;
            html += `<div class="stage-label">${s.label}</div>`;
            html += `<div class="stage-desc">${data.desc || s.desc}</div>`;

            if (s.fused && s.subSteps) {
                html += '<div class="stage-substeps">';
                for (const sub of s.subSteps) {
                    html += `<div class="substep">${sub}</div>`;
                }
                html += '</div>';
            }

            if (data.gt) {
                html += `<div class="stage-gt">GT: 0x${data.gt}</div>`;
            }
            if (data.perm) {
                html += `<div class="stage-perm ${data.status || ''}">${data.perm} ${data.status === 'pass' ? '\u2713' : data.status === 'fail' ? '\u2717' : ''}</div>`;
            }
            html += '</div>';

            if (i < displayStages.length - 1) {
                html += `<div class="pipeline-arrow ${i < this.currentStage ? 'arrow-done' : ''}">\u2192</div>`;
            }
        }

        html += '</div>';

        html += '<div class="pipeline-info">';
        if (this.currentStage >= 0 && this.currentStage < displayStages.length) {
            const s = displayStages[this.currentStage];
            const data = this.stageData[this.currentStage] || {};
            html += `<div class="pipeline-current">Stage ${this.currentStage + 1}: ${s.label}</div>`;
            html += `<div class="pipeline-detail">${data.desc || s.desc}</div>`;
        } else if (this.currentStage >= displayStages.length && displayStages.length > 0) {
            const totalGates = this.mode === 'full' ? 7 : this.mode === 'fused' ? 3 : (1 + this.chainSteps.length + 1);
            html += '<div class="pipeline-current pipeline-complete">Pipeline Complete</div>';
            html += `<div class="pipeline-detail">All ${totalGates} security gates passed \u2014 ${this._cycleComparison()}</div>`;
        } else {
            html += '<div class="pipeline-current">Ready</div>';
            html += '<div class="pipeline-detail">Step through code to see the security pipeline in action</div>';
        }
        html += '</div>';

        if (this.mode !== 'full') {
            html += '<div class="pipeline-cycle-comparison">';
            html += this._renderCycleBar();
            html += '</div>';
        }

        html += '</div>';
        this.container.innerHTML = html;
    }

    _renderAudit() {
        const steps = this.stageData || [];
        const tsbGates = ['mLoad', 'mSave', 'HEAP'];

        let html = '<div class="pipeline-wrapper pipeline-audit">';

        html += '<div class="pipeline-mode-selector">';
        for (const m of ['full', 'fused', 'chained', 'audit']) {
            const btnLabel = { full: '7-Step', fused: '3-Step Fused', chained: 'Chained', audit: 'TSB Audit' }[m];
            html += `<button class="btn btn-mode ${this.mode === m ? 'active' : ''}" onclick="setPipelineMode('${m}')">${btnLabel}</button>`;
        }
        html += '</div>';

        html += '<div class="pipeline-title">TSB Audit — mLoad / mSave Gates</div>';
        html += '<div class="pipeline-subtitle">Every capability gate shown as an explicit instruction-level audit step</div>';
        html += this._renderNIA();

        if (steps.length === 0) {
            html += '<div class="pipeline-info audit-guide">';
            html += '<div class="pipeline-current">How to see live TSB audit gates</div>';
            html += '<ol class="audit-guide-steps">';
            html += '<li>Click <b>Boot</b> (top-right) to start the boot microcode</li>';
            html += '<li>Make sure you are on the <b>Pipeline</b> tab (you are here)</li>';
            html += '<li>Click <b>Step</b> (top-right) once or twice</li>';
            html += '<li>Each step runs one instruction — every mLoad and mSave gate appears below as a live audit record with ✓/✗ per check</li>';
            html += '</ol>';
            html += '<div class="pipeline-detail">If already booted: open <b>Code</b>, write or load a program, then click <b>Step</b> from any view.</div>';
            html += '</div>';
            html += '</div>';
            this.container.innerHTML = html;
            return;
        }

        html += '<div class="audit-steps">';
        let gateCount = 0;
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const isTSB = tsbGates.includes(step.type);
            const isActive = i === this.currentStage - 1;
            const isDone  = this.currentStage >= steps.length;

            if (isTSB) {
                gateCount++;
                const overallPass = step.status === 'pass';
                html += `<div class="audit-gate ${overallPass ? 'gate-pass' : 'gate-fail'} ${isActive ? 'gate-active' : ''} ${isDone ? 'gate-done' : ''}">`;
                html += `<div class="gate-header">`;
                html += `<span class="gate-type-badge gate-${step.type.toLowerCase()}">${step.type}</span>`;
                html += `<span class="gate-label gate-label-link" onclick="pipelineGateClick(${step.nsIndex})" title="Open register detail for NS[${step.nsIndex}]">NS[${step.nsIndex}] &ldquo;${step.label}&rdquo;</span>`;
                if (step.requiredPerm) {
                    html += `<span class="gate-perm-req">requires&nbsp;<b>${step.requiredPerm}</b></span>`;
                }
                html += `<span class="gate-result ${overallPass ? 'result-pass' : 'result-fail'}">${overallPass ? '\u2713 PASS' : '\u2717 FAULT'}</span>`;
                html += `</div>`;

                if (step.checks && step.checks.length > 0) {
                    html += '<div class="gate-checks">';
                    for (const chk of step.checks) {
                        const chkClass = chk.pass ? 'check-pass' : 'check-fail';
                        const icon = chk.pass ? '\u2713' : '\u2717';
                        const label = chk.name === 'PERM' && chk.perm ? `${chk.name}&nbsp;(${chk.perm})` : chk.name;
                        html += `<span class="gate-check ${chkClass}">${icon}&nbsp;${label}</span>`;
                    }
                    if (step.b !== undefined) {
                        html += `<span class="gate-flag">B=${step.b}</span>`;
                    }
                    if (step.f !== undefined) {
                        html += `<span class="gate-flag">F=${step.f}</span>`;
                    }
                    html += '</div>';
                }
                html += '</div>';
            } else {
                html += `<div class="audit-instr-step ${isDone ? 'instr-done' : ''}">`;
                const badgeExtra = step.status === 'info' ? ' instr-badge-info' : '';
                html += `<span class="instr-stage-badge${badgeExtra}">${step.stage || step.type || 'OP'}</span>`;
                html += `<span class="instr-desc">${step.desc || ''}</span>`;
                if (step.status === 'pass') html += `<span class="instr-status-ok">\u2713</span>`;
                if (step.status === 'fail') html += `<span class="instr-status-fail">\u2717</span>`;
                if (step.status === 'info') html += `<span class="instr-status-info">\u2139</span>`;
                html += '</div>';
            }
        }
        html += '</div>';

        const tsbCount = steps.filter(s => tsbGates.includes(s.type)).length;
        html += '<div class="pipeline-info">';
        if (tsbCount > 0) {
            const allPass = steps.filter(s => tsbGates.includes(s.type)).every(s => s.status === 'pass');
            html += `<div class="pipeline-current ${allPass ? 'pipeline-complete' : 'pipeline-fault'}">`;
            html += allPass ? `\u2713 ${tsbCount} TSB gate${tsbCount > 1 ? 's' : ''} passed` : `\u2717 TSB gate fault`;
            html += '</div>';
            html += `<div class="pipeline-detail">${steps.length - tsbCount} instruction step${steps.length - tsbCount !== 1 ? 's' : ''}, ${tsbCount} capability gate${tsbCount > 1 ? 's' : ''} — all checks live from hardware model</div>`;
        } else {
            html += '<div class="pipeline-current">No TSB gates this step</div>';
            html += '<div class="pipeline-detail">This instruction did not invoke mLoad or mSave</div>';
        }
        html += '</div>';

        html += '</div>';
        this.container.innerHTML = html;
    }

    _cycleComparison() {
        if (this.mode === 'full') return '7 cycles per operation';
        if (this.mode === 'fused') return '3 cycles (was 7 \u2014 57% reduction)';
        const chainLen = this.chainSteps.length || 1;
        const chainCycles = 1 + chainLen + 1;
        const oldCycles = chainLen * 7;
        const pct = Math.round((1 - chainCycles / oldCycles) * 100);
        return `${chainCycles} cycles for ${chainLen} operations (was ${oldCycles} \u2014 ${pct}% reduction)`;
    }

    _renderCycleBar() {
        const chainLen = Math.max(1, this.chainSteps.length);
        const fullCycles = this.mode === 'fused' ? 7 : chainLen * 7;
        const newCycles = this.mode === 'fused' ? 3 : (1 + chainLen + 1);
        const pct = Math.round((newCycles / fullCycles) * 100);
        return `<div class="cycle-bar-label">Cycle comparison (per method call):</div>` +
               `<div class="cycle-bar"><div class="cycle-bar-old" style="width:100%">${fullCycles} cycles (original)</div></div>` +
               `<div class="cycle-bar"><div class="cycle-bar-new" style="width:${pct}%">${newCycles} cycles (optimized)</div></div>`;
    }

    reset() {
        this.currentStage = -1;
        this.stageData = [];
        this.chainSteps = [];
        this.animating = false;
        this.niaRows = null;
        this.render();
    }

    showFullPipeline(stageDataArray) {
        this.stageData = stageDataArray || [];
        const displayLen = this.mode === 'audit'   ? this.stageData.length :
                           this.mode === 'chained' ? (1 + this.chainSteps.length + 1) :
                           this.stages.length;
        this.currentStage = displayLen;
        this.render();
    }

    showChainedPipeline(methods, stageDataArray) {
        this._setMode('chained');
        this.chainSteps = methods || [];
        this.stageData = stageDataArray || [];
        this.currentStage = 1 + this.chainSteps.length + 1;
        this.render();
    }

    async animate(stageDataArray, delayMs) {
        delayMs = delayMs || 400;
        this.stageData = stageDataArray || [];
        this.animating = true;

        const displayLen = this.mode === 'audit'   ? this.stageData.length :
                           this.mode === 'chained' ? (1 + this.chainSteps.length + 1) :
                           this.stages.length;

        for (let i = 0; i < displayLen; i++) {
            if (!this.animating) break;
            this.currentStage = i;
            this.render();
            await new Promise(r => setTimeout(r, delayMs));
        }

        if (this.animating) {
            this.currentStage = displayLen;
            this.render();
        }
        this.animating = false;
    }

    stopAnimation() {
        this.animating = false;
    }

    setStage(idx, data) {
        this.currentStage = idx;
        if (data) this.stageData[idx] = data;
        this.render();
    }

    buildSecurityTrace(operation, details) {
        const trace = [];
        const opUpper = (operation || '').toUpperCase();

        switch (opUpper) {
            case 'CALL':
                trace.push({ desc: `LOAD: Namespace lookup via CR${details.crSrc || 6}`, perm: 'L', status: 'pass', gt: details.gt || '' });
                trace.push({ desc: `TPERM: Verify E permission on target`, perm: 'E', status: 'pass' });
                trace.push({ desc: `CALL: Enter ${details.target || 'abstraction'}, save context` });
                trace.push({ desc: `LOAD: C-List slot [1] = Access Code`, perm: 'L', status: 'pass' });
                trace.push({ desc: `TPERM: Verify X on Access Code`, perm: 'X', status: 'pass' });
                trace.push({ desc: `LAMBDA: Church reduction \u2192 ${details.result || 'compute'}` });
                trace.push({ desc: `RETURN: Restore scope, result in DR0` });
                break;
            case 'ELOADCALL':
                trace.push({ desc: `ELOADCALL: LOAD + TPERM(E) + CALL \u2192 ${details.target || 'abstraction'}`, perm: 'L,E', status: 'pass' });
                trace.push({ desc: `XLOADLAMBDA: LOAD + TPERM(X) + LAMBDA \u2192 ${details.result || 'compute'}`, perm: 'L,X', status: 'pass' });
                trace.push({ desc: `RETURN: Restore scope, result in DR0` });
                break;
            case 'CHAIN':
                trace.push({ desc: `ELOADCALL: Enter ${details.target || 'abstraction'} (LOAD+TPERM+CALL)`, perm: 'L,E', status: 'pass' });
                if (details.methods) {
                    for (let i = 0; i < details.methods.length; i++) {
                        trace.push({ desc: `XLOADLAMBDA: ${details.methods[i]}${details.intermediates && details.intermediates[i] ? ' \u2192 ' + details.intermediates[i] : ''}`, perm: 'X', status: 'pass' });
                    }
                }
                trace.push({ desc: `RETURN: Restore scope, result = ${details.result || '?'}` });
                break;
            case 'LAMBDA':
                trace.push({ desc: `LOAD: Read CR${details.crDst || 0} capability`, perm: 'L', status: 'pass' });
                trace.push({ desc: `TPERM: Verify E permission`, perm: 'E', status: 'pass' });
                trace.push({ desc: `CALL: Fast-path lambda entry` });
                trace.push({ desc: `LOAD: C-List access code`, perm: 'L', status: 'pass' });
                trace.push({ desc: `TPERM: Verify execution`, perm: 'X', status: 'pass' });
                trace.push({ desc: `LAMBDA: ${details.desc || 'Church reduction'}` });
                trace.push({ desc: `RETURN: Result \u2192 DR0 = ${details.result || '?'}` });
                break;
            default:
                trace.push({ desc: `${opUpper}: ${details.desc || 'execute'}` });
                break;
        }
        return trace;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PipelineVisualizer;
}
