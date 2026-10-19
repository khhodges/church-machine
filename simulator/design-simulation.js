// Explicit, admitted ascending replay. Never uses the historical image loader,
// installs candidate files or sends hardware commands.
(function(root) {
    'use strict';
    let machine = null, provenance = null, frozenWords = null, owner = null;
    let busy = false, running = false, generation = 0, runEpoch = 0, steps = 0, intent = 0;
    let reportedMachine = null, reportedOutput = '', reportedFaults = 0;
    let previousSimulator = null;

    function freezeRecord(value) {
        if (!value || typeof value !== 'object') return value;
        return Object.freeze(Array.isArray(value) ? value.map(freezeRecord) :
            Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeRecord(item)])));
    }
    function displayMachine(candidate) {
        if (typeof sim !== 'undefined') {
            if (!previousSimulator) previousSimulator=sim;
            sim=candidate;
        }
        if (typeof repl !== 'undefined' && repl) repl.sim=candidate;
        if(typeof root.clearTrace==='function') root.clearTrace();
    }
    function refreshDisplays() {
        if (!machine || typeof sim==='undefined' || sim!==machine) return;
        machine.running=running;
        if(typeof root.updateDashboard==='function') root.updateDashboard();
        if(typeof root.updateThreadControl==='function') root.updateThreadControl();
        if(typeof root.updateLedStrip==='function') root.updateLedStrip();
    }

    // Runtime output belongs in the existing console, not a second simulator UI.
    function publishExecution() {
        if (!machine) return;
        if (reportedMachine !== machine) {
            reportedMachine=machine; reportedOutput=''; reportedFaults=0;
        }
        const output=String(machine.output || '');
        const added=output.startsWith(reportedOutput) ? output.slice(reportedOutput.length) : output;
        if (added && typeof root.appendOutput==='function') root.appendOutput(added,'info');
        reportedOutput=output;
        const faults=machine.faultLog || [];
        for (const fault of faults.slice(reportedFaults)) {
            if (typeof root._reportSimulatorFault === 'function') {
                root._reportSimulatorFault(fault);
                continue;
            }
            const text='Simulation fault: '+(fault.message || fault.type || 'Unknown fault');
            if(typeof root.appendOutput==='function') root.appendOutput(text,'error');
            if(typeof root._showFpgaToast==='function') root._showFpgaToast('Simulation fault',text,'error',15000);
        }
        reportedFaults=faults.length;
    }

    function recordConsoleStep(result, bootPhase) {
        if (typeof document === 'undefined') return;
        const con = document.getElementById('editorConsole');
        if (!con) return;
        // Preserve compiled listings and exact CALL/RETURN evidence buttons.
        let target = con;
        if (con.classList.contains('cmp-html')) {
            target = con.querySelector('[data-runtime-output]');
            if (!target) {
                target = document.createElement('pre');
                target.dataset.runtimeOutput = '';
                target.style.whiteSpace = 'pre-wrap';
                con.appendChild(target);
            }
        }
        if (bootPhase != null) {
            const lastLine = String(machine.output || '').split('\n').filter(Boolean).pop() || '';
            target.appendChild(document.createTextNode(`\n[boot ${bootPhase}/3] ${lastLine}`));
        } else {
            if (typeof root._appendSimulatorStepLog === 'function') root._appendSimulatorStepLog(result, target);
            for (const stage of result.pipeline || []) {
                target.appendChild(document.createTextNode(
                    `\n     → ${(stage.stage || '').padEnd(6)}  ${stage.desc || ''}`));
            }
        }
        con.scrollTop = con.scrollHeight;
    }

    let toolbarOwned = false;
    let message = 'Save a LUMP or prepare this saved design for private simulation. Hardware and installed images stay unchanged.';
    const esc = value => String(value).replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function selection() {
        const state = root.NamespaceDesignV1 && root.NamespaceDesignV1.state;
        if (!state || !state.active || state.dirty || !state.document || !state.fingerprint)
            throw Error('Save the selected Namespace design before private simulation.');
        return {profile:state.profile, fingerprint:state.fingerprint, document:JSON.stringify(state.document)};
    }
    function same(selected) {
        try { return JSON.stringify(selection()) === JSON.stringify(selected); }
        catch (_) { return false; }
    }
    function markup() {
        const ready = machine && owner && same(owner);
        return '<strong>Selected design · private simulator</strong> ' +
            '<button class="btn btn-sm" onclick="DesignSimulation.prepare()" title="Validate, approve and load this exact saved design for private simulation"' + (busy?' disabled':'') + '>Prepare fresh simulation</button> ' +
            ['Step','Run','Stop','Reset'].map(action =>
                '<button class="btn btn-sm" onclick="DesignSimulation.'+action.toLowerCase()+'()"' +
                (busy || !ready || (running && action!=='Stop') ? ' disabled' : '') + '>'+action+'</button>').join(' ') +
            '<p role="status" style="white-space:pre-wrap">'+esc(message)+'</p>'+
            (provenance && !ready ? '<p role="alert">The selected design has changed. These retained bytes are not current; prepare the selected design again before execution.</p>' : '')+
            (provenance ? '<details><summary>Exact simulation identity</summary><pre style="white-space:pre-wrap">'+
                esc(JSON.stringify({profile:provenance.designProfile, imageHash:provenance.imageHash,
                    configurationHash:provenance.configurationHash, approvedRevisionId:provenance.approvedRevisionId,
                    artifactBindings:provenance.artifactBindings},null,2))+'</pre></details>':'')+
            (machine ? '<pre style="white-space:pre-wrap">'+esc('Instructions: '+steps+
                ' · NIA: '+machine.pc+' · DR1: '+(machine.dr[1]>>>0)+
                (machine.halted?' · stopped':'')+'\n'+(machine.output || '').slice(-4000)+
                '\n'+(machine.faultLog || []).map(f=>f.message || f.type).join('\n'))+'</pre>':'')+
            '<small>Main Run, Step, Walk and Reset use this selected design. No legacy-image fallback, hardware certification or installation.</small>';
    }
    function render() {
        if (typeof document === 'undefined') return;
        if (typeof root._renderTraceExecutionIdentity === 'function') root._renderTraceExecutionIdentity();
        if (typeof root._showStopBtn === 'function' &&
                (root.NamespaceDesignV1?.state.active || toolbarOwned)) {
            toolbarOwned = !!root.NamespaceDesignV1?.state.active && (busy || running);
            root._showStopBtn(toolbarOwned);
        }
        const host = document.getElementById('designSimulationPanel');
        if (host) host.innerHTML = markup();
        refreshDisplays();
    }
    function stop() {
        intent++; runEpoch++; running=false;
        if (busy) {
            // Revoke the pending operation before releasing the toolbar. Late
            // responses must neither admit bytes nor modify a newer operation.
            generation++; busy=false;
            message='Execution was stopped while preparation was pending. No instruction ran.';
        }
        render();
    }
    function invalidate() {
        if(previousSimulator && typeof sim!=='undefined' && sim===machine) {
            sim=previousSimulator;
            if(typeof repl!=='undefined' && repl) repl.sim=sim;
        }
        previousSimulator=null;
        generation++; runEpoch++; busy=false; running=false; machine=null; provenance=null; frozenWords=null; owner=null;
        message='Saved revision changed. Prepare a fresh private simulation; previous execution is stopped.';
        render();
    }
    async function request(selected, action, payload) {
        const response = await fetch('/api/simulation/design/'+selected.profile+'/'+action, {
            method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'NamespaceDesign'},
            body:JSON.stringify(payload)});
        const data = await response.json();
        if (!response.ok || data.ok===false) throw Error([data.error,data.nextAction].filter(Boolean).join(' ') || 'Private simulation request failed.');
        return data;
    }
    function create(words, record) {
        const instance = ChurchSimulator.fromAscendingNamespaceImage(new Uint32Array(words), {
            word0:0x02000001, word1:0, word2:record.slotCount*4-1, word3:0, m:1});
        instance.beginBoot();
        instance.simulationConfiguration=freezeRecord(record);
        if(typeof instance.on==='function') {
            if(typeof root._traceRecordStep==='function') instance.on('step',root._traceRecordStep);
            if(typeof root._onSimFaultSnapshot==='function') instance.on('faultSnapshot',root._onSimFaultSnapshot);
        }
        return instance;
    }
    async function prepare(throwOnError=false) {
        if (busy) {
            if (throwOnError) throw Error('Private simulation preparation is already in progress; retry after it finishes.');
            return false;
        }
        invalidate();
        busy=true;
        const ticket=generation;
        try {
            const selected=selection();
            const check=()=>{if(ticket!==generation || !same(selected)) throw Error('Namespace selection changed during preparation. Retry the selected design.');};
            message='Validating exact saved identities and preparing private simulation…'; render();
            const review=await request(selected,'prepare',{namespaceFingerprint:selected.fingerprint});
            check();
            if (review.imageFormat!=='ascending-nst-metadata-slot0-v1' ||
                review.designProfile!==selected.profile || review.sourceNamespaceFingerprint!==selected.fingerprint ||
                review.hardwareCertified!==false || !review.configurationHash || !review.imageHash ||
                !Number.isInteger(review.slotCount) || !Array.isArray(review.artifactBindings))
                throw Error('Preparation did not provide exact ascending simulation provenance.');
            const body={preparationId:review.preparationId,configurationHash:review.configurationHash};
            const approved=await request(selected,'approve',body);
            check();
            if(approved.approved!==true || approved.configurationHash!==review.configurationHash ||
               approved.imageHash!==review.imageHash || !approved.approvedRevisionId)
                throw Error('Approval did not match the exact reviewed simulation.');
            const active=await request(selected,'activate',body);
            check();
            if(active.activated!==true || active.configurationHash!==review.configurationHash ||
               active.imageHash!==review.imageHash || active.designProfile!==selected.profile ||
               active.hardwareCertified!==false || !Array.isArray(active.words) ||
               !active.words.length || !active.words.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff))
                throw Error('Activation did not return the exact admitted private image.');
            const bytes=new ArrayBuffer(active.words.length*4), view=new DataView(bytes);
            active.words.forEach((word,index)=>view.setUint32(index*4,word,true));
            const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
                b=>b.toString(16).padStart(2,'0')).join('');
            check();
            if(hash!==review.imageHash) throw Error('Private simulation bytes failed the approved image hash.');
            const candidate=create(active.words,review);
            check();
            machine=candidate; frozenWords=active.words.slice(); owner=selected;
            displayMachine(machine);
            provenance={...review,approvedRevisionId:approved.approvedRevisionId}; steps=0;
            message='Fresh selected design loaded and verified. Use Step or Run here. Historical artifacts, installed image and hardware are unchanged.';
            return true;
        } catch(error) {
            if(ticket===generation) message='Private simulation blocked: '+error.message;
            if(throwOnError) throw error;
            return false;
        } finally {
            if(ticket===generation) { busy=false; render(); }
        }
    }
    function ready() {
        if(busy || !machine || !same(owner)) {
            stop(); message='The selected design differs from this private simulation. Prepare it again.'; render(); return false;
        }
        try { checkViewedTarget(selection()); }
        catch(error) { stop(); message=error.message; render(); return false; }
        return true;
    }
    function checkViewedTarget(selected) {
        const boot=JSON.parse(selected.document).rows.filter(row=>row.boot);
        if(boot.length!==1 || !boot[0].selection)
            throw Error('Select exactly one saved execution target in this Namespace. No default target will run.');
        if(typeof document==='undefined') return;
        const editor=document.getElementById('editor');
        const repository=document.getElementById('lumps');
        const viewed=editor?.classList.contains('active') ? root._editorSavedBinaryReceipt :
            repository?.classList.contains('active') ? document.getElementById('lumpsDetailContent')?._displayedLump : null;
        if(viewed && (viewed.token!==boot[0].selection.token ||
                viewed.filename!==boot[0].selection.filename ||
                viewed.binary_hash!==boot[0].selection.binaryHash))
            throw Error('The viewed saved LUMP is not the selected Namespace execution target. Select it in Namespace before running; no other image was run.');
    }
    function execute(count) {
        if(!ready()) return false;
        if(machine.halted) throw Error('Simulation is halted. Use Reset before stepping or running again.');
        let paused=false;
        try {
            for(let i=0;i<count && !machine.halted;i++) {
                const booting=!machine.bootComplete;
                if(booting && typeof root._bootLoadCR15BreakpointBeforeNextInstruction==='function' &&
                        root._bootLoadCR15BreakpointBeforeNextInstruction()) {
                    root._reportBootLoadCR15BreakpointPause();
                    message='Breakpoint at B:00 — LOAD CR15 (paused before execution).';
                    paused=true; break;
                }
                if(!booting && typeof root._breakpointBeforeNextInstruction==='function') {
                    const address=root._breakpointBeforeNextInstruction();
                    if(address!==null) {
                        root._reportBreakpointPause(address);
                        message='Breakpoint at 0x'+(address>>>0).toString(16).toUpperCase()+' (paused before execution).';
                        paused=true; break;
                    }
                }
                const bootPhase = booting ? machine.bootStep + 1 : null;
                const bootProgress = booting && machine.bootProgress && machine.bootProgress[machine.bootStep];
                const bootPre = bootProgress && typeof machine._executionEvidenceState === 'function'
                    ? machine._executionEvidenceState() : null;
                if (booting) machine.auditLog = [];
                const result=booting ? machine._bootStep() : machine.step();steps++;
                publishExecution();
                if(booting) {
                    if (bootProgress && typeof root._traceRecordStep === 'function') {
                        const bootEvidence = freezeRecord({domain:'boot-rom', phase:bootPhase,
                            instruction:{raw:bootProgress.word, bootRomAddress:bootProgress.bootRomAddress},
                            progress:bootProgress, pre:bootPre, post:machine._executionEvidenceState(),
                            simulationConfiguration:machine.simulationConfiguration});
                        root._traceRecordStep({
                            bootEvidence, instr:machine.decodeInstruction(bootProgress.word),
                            desc:`Boot ${bootPhase}/3 · ${bootProgress.instruction} — ${bootProgress.status}`});
                    }
                    const audit = (machine.auditLog || []).slice();
                    if (typeof _bootAuditAccum !== 'undefined') _bootAuditAccum = audit;
                    recordConsoleStep(null, bootPhase);
                    if(typeof pipelineViz!=='undefined' && pipelineViz && typeof _bootNIARows==='function') {
                        pipelineViz.setNIA(_bootNIARows(machine.bootStep));
                        if (pipelineViz.mode === 'audit') {
                            pipelineViz.showFullPipeline(audit.map(a => ({
                                stage:a.gate, type:a.gate,
                                desc:a.desc !== undefined ? a.desc : a.nsIndex != null
                                    ? `${a.gate}(NS[${a.nsIndex}]="${a.label}"${a.requiredPerm ? ', '+a.requiredPerm : ''})`
                                    : `${a.gate} — ${a.label}`,
                                label:a.label, nsIndex:a.nsIndex, requiredPerm:a.requiredPerm,
                                checks:Object.entries(a.checks || {}).map(([k,v]) =>
                                    ({name:k.toUpperCase(),pass:v.pass,perm:v.perm || null})),
                                status:a.result, b:a.b, f:a.f,
                            })));
                        } else pipelineViz.render();
                    }
                    if(machine.bootComplete && typeof root._setEntryBreakpoint==='function') root._setEntryBreakpoint();
                    continue;
                }
                if(!result || result.absent || result.suspended || result.lazySuspended) {
                    message='Simulation paused: execution is suspended. No further instruction was attempted.';
                    paused=true; break;
                }
                recordConsoleStep(result, null);
                if(result && typeof root._wukongRecordSimulatorStep==='function') root._wukongRecordSimulatorStep(result);
                if (typeof pipelineViz !== 'undefined' && pipelineViz &&
                        typeof _buildNIARows === 'function') {
                    pipelineViz.setNIA(_buildNIARows(result.physicalPC ?? result.pc, machine._nextPhysicalAddr()));
                    const stages = pipelineViz.mode === 'audit' && result.auditPipeline
                        ? result.auditPipeline : result.pipeline;
                    if (stages) pipelineViz.showFullPipeline(stages);
                } else if(result && result.pipeline && typeof _pendingPipelineBuffer!=='undefined') {
                    _pendingPipelineBuffer={pc:result.physicalPC ?? result.pc,pipeline:result.pipeline};
                    if(typeof root._flushPendingPipelineBuffer==='function') root._flushPendingPipelineBuffer();
                }
            }
            if(!paused) message=machine.halted ? 'Private simulation stopped. Inspect its output/fault below; Reset reuses the same verified bytes.' : 'Executing the exact approved private simulation.';
        } catch(error) {
            running=false;machine.halted=true;message='Simulation stopped: '+error.message;
            if(typeof root.appendOutput==='function') root.appendOutput(message,'error');
            if(typeof root._showFpgaToast==='function') root._showFpgaToast('Simulation stopped',message,'error',15000);
        }
        if(paused || machine.halted) running=false;
        publishExecution();
        render();
        return !machine.halted && !paused;
    }
    function run(walking=false) {
        if(running || !ready()) return;
        running=true;
        // Match normal Run: settings are captured once; breakpoints remain live.
        const unlimited=typeof continuousRun!=='undefined' && continuousRun;
        const size=typeof runBatchSize!=='undefined' && Number.isFinite(runBatchSize)
            ? Math.max(1,Math.min(10000,Math.floor(runBatchSize))) : 500;
        let executed=0;
        const ticket=generation, epoch=++runEpoch;
        const batch=()=>{
            if(!running || ticket!==generation || epoch!==runEpoch) return;
            const booting=!machine.bootComplete;
            const before=steps;
            const proceed=execute(booting || walking ? 1 : unlimited ? size : Math.min(size,10000-executed));
            if(!booting) executed+=steps-before;
            if(!walking && !unlimited && executed>=10000 && proceed) {
                running=false;
                message='Run paused after 10000 instructions. Enable Continuous Run to run without this limit.';
                if(typeof root.appendOutput==='function') root.appendOutput(message,'info');
                render(); return;
            }
            if(proceed && running) setTimeout(batch,booting || walking ? 500 : size===1 ? 16 : 0);
            else {running=false;render();}
        };
        batch();
    }
    function reset() {
        if(!ready()) return;
        stop();
        try { machine=create(frozenWords,provenance);displayMachine(machine);steps=0;message='Reset to the same verified image and entry Thread.'; }
        catch(error) {machine=null;message='Private reset blocked: '+error.message;}
        render();
    }
    async function command(action) {
        let actionIntent=intent;
        try {
            if(action==='stop') { stop(); return true; }
            if(root.TargetState && !root.TargetState.authorize('simulator',{id:'simulator-state'}).ok)
                throw Error('Select the Simulator target before executing this design.');
            if(action==='walk' && running) { stop(); return true; }
            const selected=selection();
            checkViewedTarget(selected);
            if(typeof sim!=='undefined' && sim!==machine && (sim.running || sim.walkActive) && typeof stopSim==='function') stopSim();
            actionIntent=++intent;
            if(!machine || !same(owner)) await prepare(true);
            if(actionIntent!==intent) throw Error('Execution was stopped while preparation was pending. No instruction ran.');
            if(!same(selected)) throw Error('Selection changed before execution.');
            if(action==='prepare') return true;
            if(action==='reset') reset();
            else if(action==='step') {
                if(running) throw Error('Simulation is running. Stop it before stepping.');
                if(!ready()) throw Error(message);
                if(machine.halted) throw Error('Simulation is halted. Use Reset before stepping again.');
                return execute(1);
            }
            else if(action==='run' || action==='walk') {
                if(machine.halted) throw Error('Simulation is halted. Use Reset before running again.');
                run(action==='walk');
            }
            else throw Error('Unknown selected simulation action.');
            // Keep the programmer in their chosen view; no internal test panel.
            return true;
        } catch(error) {
            if(actionIntent!==intent) return false;
            stop(); message='Selected simulation blocked: '+error.message; render();
            if(typeof root.appendOutput==='function') root.appendOutput(message,'error');
            if(typeof root._showFpgaToast==='function') root._showFpgaToast('Simulation blocked',message,'error',15000);
            return false;
        }
    }
    root.DesignSimulation={prepare,command,stop,invalidate,markup,render,run,reset,traceContext,traceIdentity,
        step:()=>{if(!running) execute(1);}};

    // Verify the occurrence against the admitted image, never editor/registry
    // selection or a post-CALL CR14. Mutable data is not executable identity.
    function traceIdentity(result) {
        const context = traceContext(), evidence = result && result.executionEvidence;
        const pre = evidence && evidence.pre, instruction = evidence && evidence.instruction;
        const configuration = context && context.configuration;
        if (!context || !context.current || evidence !== machine.lastStepEvidence ||
                !pre || !pre.cr || !pre.cr[15] || !instruction ||
                JSON.stringify(evidence.simulationConfiguration) !== JSON.stringify(configuration)) return null;
        const slot = pre.artifact && pre.artifact.slot;
        const bindings = configuration.artifactBindings.filter(binding => binding.slot === slot);
        if (bindings.length !== 1 || !Number.isInteger(slot) || slot < 1 ||
                slot >= configuration.slotCount || pre.cr[15].word1 !== 0 ||
                pre.cr[15].word2 !== configuration.slotCount * 4 - 1) return null;
        if (!machine.cr || !machine.cr[15] ||
                ['word0','word1','word2'].some(key => machine.cr[15][key] !== pre.cr[15][key])) return null;
        const binding = bindings[0], name = /^(.+)\.([1-9][0-9]*)\.([0-9a-f]{8})\.lump$/.exec(binding.filename);
        if (!name || !/^[0-9a-f]{64}$/.test(binding.binaryHash)) return null;
        const descriptor = slot * 4, base = frozenWords[descriptor];
        const code = pre.artifact.codeCapability;
        // mLoad marks the live descriptor's G bit. That GC visitation bit
        // changes during ordinary boot; it is not a new artifact or generation.
        const withoutG = word => (word & ~0x40000000) >>> 0;
        if (!code || code.word1 !== base ||
                withoutG(code.word2) !== withoutG(frozenWords[descriptor + 1]) ||
                pre.artifact.headerWord !== frozenWords[base]) return null;
        for (let i = 0; i < 4; i++) {
            const actual = machine.memory[descriptor + i], expected = frozenWords[descriptor + i];
            if (i === 1 ? withoutG(actual) !== withoutG(expected) : actual !== expected) return null;
        }
        const header = machine.parseLumpHeader(frozenWords[base]);
        const pc = instruction.physicalPC;
        if (header.magic !== 31 || header.cw + header.cc + 1 > header.lumpSize ||
                !Number.isInteger(pc) || pc <= base || pc > base + header.cw ||
                instruction.raw !== frozenWords[pc] || base + header.lumpSize > frozenWords.length) return null;
        // Check all code and localized capability rows, not just one matching
        // instruction. Runtime data/freespace may legitimately change.
        for (let i = 0; i <= header.cw; i++)
            if (machine.memory[base + i] !== frozenWords[base + i]) return null;
        for (let i = header.lumpSize - header.cc; i < header.lumpSize; i++)
            if (machine.memory[base + i] !== frozenWords[base + i]) return null;
        return Object.freeze({dotName:name[1] + '#' + name[2], token:binding.token,
            filename:binding.filename, binaryHash:binding.binaryHash, nsSlot:slot,
            instrIdx:pc - base - 1, physicalPC:pc, rawWord:instruction.raw,
            configurationHash:configuration.configurationHash, imageHash:configuration.imageHash});
    }

    function traceContext() {
        return machine && typeof sim !== 'undefined' && sim === machine
            ? {configuration:machine.simulationConfiguration, current:same(owner), bootComplete:machine.bootComplete}
            : null;
    }
})(typeof window!=='undefined'?window:globalThis);
