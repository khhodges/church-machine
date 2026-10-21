'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const code=fs.readFileSync(__dirname+'/design-simulation.js','utf8');
const scripts=[...fs.readFileSync(__dirname+'/index.html','utf8').matchAll(/<script src="([^"?]+)/g)].map(m=>m[1]);
assert(scripts.indexOf('namespace-runtime-core.js') < scripts.indexOf('design-simulation.js'));
assert(scripts.indexOf('design-simulation.js') < scripts.indexOf('namespace-design-v1.js'));
function harness(defect) {
    const panel={innerHTML:''},calls=[],instances=[];
    const toolbar=[], timers=[];
    const words=[0xf8810100,0,2,0], profile='ascending', fingerprint='a'.repeat(64);
    const hash=require('node:crypto').createHash('sha256').update(Buffer.from(new Uint32Array(words).buffer)).digest('hex');
    const review={preparationId:'ticket',configurationHash:'b'.repeat(64),imageHash:hash,
        designProfile:profile,sourceNamespaceFingerprint:fingerprint,hardwareCertified:false,
        imageFormat:'ascending-nst-metadata-slot0-v1',slotCount:64,artifactBindings:[{filename:'exact.lump'}]};
    const scope={console,setTimeout,Uint32Array,Uint8Array,ArrayBuffer,DataView,crypto:webcrypto,
        _showStopBtn:show=>toolbar.push(show),
        NamespaceDesignV1:{state:{active:true,profile,fingerprint,document:{rows:[
            {slot:10,boot:true,selection:{token:'961bfee3',filename:'exact.lump',binaryHash:'b'.repeat(64)}}
        ]},dirty:false}},
        document:{getElementById:id=>id==='designSimulationPanel'?panel:null},
        // Reject any accidental switch to the legacy machine.
        sim:{activateSimulationConfiguration(){throw Error('legacy activation forbidden');}},
        ChurchSimulator:{fromAscendingNamespaceImage(image,cr15){
            assert.equal(cr15.word2,255);
            const listeners={};
            const machine={pc:1,dr:Array(16).fill(0),faultLog:[],halted:false,
                listeners,on(name,callback){(listeners[name] ||= []).push(callback);},
                beginBoot(){this.bootComplete=defect!=='boot';this.bootStep=0;},
                _bootStep(){this.bootStep++;this.bootComplete=this.bootStep===3;return true;},
                step(){
                    this.pc++;this.dr[1]++;this.halted=this.dr[1]===3;
                    const result={pc:this.pc};
                    for(const callback of listeners.step || []) callback(result);
                    return result;
                }};
            instances.push(machine);return machine;
        }},
        fetch:async(url,options)=>{
            calls.push(url);
            assert(url.startsWith('/api/simulation/design/ascending/'));
            assert.equal(options.headers['X-Requested-With'],'NamespaceDesign');
            const action=url.split('/').pop();
            if(defect==='changed' && action==='prepare') scope.NamespaceDesignV1.state.dirty=true;
            const data=action==='prepare'?review:action==='approve'?{...review,approved:true,approvedRevisionId:'revision'}:
                {...review,activated:true,words:defect==='bytes'?[...words,1]:words};
            if(defect==='rejected' && action==='prepare')return {ok:false,json:async()=>({error:'Embedded API names RunAbstraction',nextAction:'Compile a new revision.'})};
            return {ok:true,json:async()=>data};
        }};
    if(defect==='boot') scope.setTimeout=callback=>timers.push(callback);
    scope.window=scope;vm.createContext(scope);vm.runInContext(code,scope);
    return {api:scope.DesignSimulation,scope,calls,instances,panel,toolbar,timers};
}
(async()=>{
    const saved = harness('boot');
    const saveViews = [];
    saved.scope.switchView = view => saveViews.push(view);
    await saved.api.prepare(true, {preserveView:true});
    assert.deepEqual(saveViews, [], 'save preparation preserves the current view');
    assert.equal(saved.instances[0].bootStep, 0, 'save executes no boot instructions');
    assert.equal(saved.instances[0].pc, 1);
    assert.equal(saved.timers.length, 0, 'save schedules no execution');
    const explicit = harness('boot');
    const explicitViews = [];
    explicit.scope.switchView = view => explicitViews.push(view);
    await explicit.api.prepare(true);
    assert.deepEqual(explicitViews, ['pipeline'], 'explicit preparation retains boot navigation');
    // The selected runtime must use the existing Boot/Code presentation, not
    // merely append raw machine output. Keep rich listings and step evidence.
    const {JSDOM} = require('jsdom');
    const runSource = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
    for (const action of ['step', 'walk', 'run']) {
        const b = harness('boot');
        const dom = new JSDOM('<div id="editorConsole" class="cmp-html"><button id="listing">Compiled listing</button></div>');
        b.scope.document = dom.window.document;
        vm.runInContext(runSource.slice(runSource.indexOf('function appendOutput('),
            runSource.indexOf('function escapeHtml(', runSource.indexOf('function appendOutput('))), b.scope);
        vm.runInContext(runSource.slice(runSource.indexOf('function _appendSimulatorStepLog('),
            runSource.indexOf('let _wukongStaleBannerDismissed', runSource.indexOf('function _appendSimulatorStepLog('))), b.scope);
        const frames = [];
        b.scope.pipelineViz = {mode:'audit',setNIA() {},render() {},
            showFullPipeline: stages => frames.push(stages)};
        b.scope._bootNIARows = () => [];
        b.scope._buildNIARows = () => [];
        b.scope._bootAuditAccum = [];
        await b.api.prepare(true);
        const machine = b.instances[0], step = machine.step.bind(machine);
        machine.output = '';
        machine._bootStep = function() {
            this.bootStep++; this.bootComplete = this.bootStep === 3;
            this.output += `Boot instruction ${this.bootStep}\n`;
            this.auditLog.push({gate:'NS',label:`boot-${this.bootStep}`,result:'pass',
                checks:{identity:{pass:true}}});
        };
        machine._nextPhysicalAddr = () => machine.pc;
        machine.step = function() {
            const result = step();
            this.output += `Code output ${this.dr[1]}\n`;
            return Object.assign(result, {stepCount:this.dr[1],desc:`Instruction ${this.dr[1]}`,
                pipeline:[{stage:'EXEC',desc:'executed code'}],
                auditPipeline:[{stage:'CHECK',desc:'code audit'}],
                eventLocation:{kind:'CALL'}});
        };
        if (action === 'step') {
            for (let i=0;i<6;i++) await b.api.command('step');
        } else {
            await b.api.command(action);
            while (b.timers.length) b.timers.shift()();
        }
        const con = dom.window.document.getElementById('editorConsole');
        assert(dom.window.document.getElementById('listing'), action+' preserves the listing');
        for (let i=1;i<=3;i++) {
            assert(con.textContent.includes(`[boot ${i}/3]`), action+' displays each boot step');
            assert(con.textContent.includes(`[${i}] Instruction ${i}`), action+' displays each code step');
        }
        assert.match(con.textContent,/EXEC\s+executed code/);
        assert.equal(con.querySelectorAll('.call-return-event').length,3,
            action+' retains exact step drilldowns after later output');
        assert.equal(frames.length,6);
        assert.equal(frames[0].length,1);
        assert.equal(frames[2][0].label,'boot-3','Boot audit replaces the previous step');
        assert.equal(frames[3][0].desc,'code audit','Code trace honors audit mode');
        assert.equal(b.scope._bootAuditAccum.length,1);
        dom.window.close();
    }
    // Exercise the shared core's actual pause/resume semantics through the
    // selected-design controls, with deterministic timers and no live writes.
    const Core=require('./simulator.js');
    for (const action of ['step','walk','run']) {
        const b = harness('boot'), views = [], registers = [];
        b.scope.switchView = view => views.push(view);
        b.scope.openCRDetail = cr => registers.push(cr);
        await b.api.command(action);
        assert.deepEqual(views,['pipeline'],action+' opens Boot at start');
        assert.deepEqual(registers,[]);
        if(action==='step') await b.api.command('step');
        else b.timers.shift()();
        assert.deepEqual(registers,[],action+' does not open Code during boot');
        if(action==='step') await b.api.command('step');
        else b.timers.shift()();
        assert.equal(b.instances[0].bootStep,3);
        assert.equal(views.at(-1),'dashboard');
        assert.deepEqual(registers,[14],action+' opens CR14 immediately at boot exit');
        assert.equal(b.instances[0].dr[1],0,'no Code instruction required to open Code');
        await b.api.command('reset');
        assert.equal(views.at(-1),'pipeline','Reset reopens Boot');
        assert.equal(b.instances.at(-1).bootStep,0);
        for(const timer of b.timers) timer();
        assert.equal(views.at(-1),'pipeline','old callbacks cannot reopen Code');
    }
    for (const action of ['step','walk','run']) {
        const b = harness('boot'), modals = [];
        b.scope._lastFault = null;
        b.scope.appendOutput = () => {};
        b.scope.faultAlertOn = () => {};
        b.scope.showFaultModal = fault => modals.push(fault);
        vm.runInContext(runSource.slice(runSource.indexOf('function _reportSimulatorFault('),
            runSource.indexOf('function faultAlertOn(')), b.scope);
        await b.api.prepare(true);
        const machine = b.instances[0];
        machine.bootComplete = true;
        machine.cr = Array.from({length:16},()=>({word0:0,word1:0,m:0}));
        machine.cr[6] = {word0:1,word1:0,m:1};
        machine.memory = new Uint32Array(64); // indexed target is NULL
        machine._clistCountForCR = () => 10;
        machine.mLoad = () => ({ok:true});
        machine.parseGT = Core.prototype.parseGT;
        machine._activateChangeThread = Core.prototype._activateChangeThread;
        machine.fault = function(type,message) {
            this.faultLog.push({type,message,pc:15,physicalPC:0x0710});
            this.halted = true;
        };
        machine.step = function() {
            const word = 0x27630009;
            Core.prototype._execChangeCore.call(this,
                {crDst:(word>>>19)&15, crSrc:(word>>>15)&15, imm:word&0x7fff},16);
            return {pc:15,physicalPC:0x0710};
        };
        await b.api.command(action);
        assert.equal(machine.halted,true);
        assert.equal(modals.length,1,action+' opens the shared fault modal');
        assert.equal(modals[0],machine.faultLog[0],'modal retains exact fault evidence');
        assert.equal(modals[0].type,'TYPE');
        assert.equal(b.scope._lastFault,modals[0],'fault recall uses the same incident');
        b.api.render(); b.api.stop();
        assert.equal(modals.length,1,'render and stop do not reopen the dismissed fault');
    }
    for(const action of ['step','walk','run']) {
        const b=harness('boot');
        const pauses=[];
        await b.api.prepare(true);
        const m=b.instances[0];
        m.bootAttemptId=1;
        m.checkBootLoadCR15BreakpointBeforeExecute=Core.prototype.checkBootLoadCR15BreakpointBeforeExecute;
        m.checkBreakpointBeforeExecute=Core.prototype.checkBreakpointBeforeExecute;
        m._nextPhysicalAddr=()=>m.pc;
        m.memory=new Uint32Array(100);
        m.decodeInstruction=()=>({opcode:4});
        const addresses=new Set(), opcodes=new Set();
        b.scope._bootLoadCR15BreakpointBeforeNextInstruction=()=>m.checkBootLoadCR15BreakpointBeforeExecute(true);
        b.scope._reportBootLoadCR15BreakpointPause=()=>pauses.push('boot');
        b.scope._breakpointBeforeNextInstruction=()=>m.checkBreakpointBeforeExecute(addresses,opcodes);
        b.scope._reportBreakpointPause=addr=>pauses.push(addr);
        b.scope._setEntryBreakpoint=()=>addresses.add(m.pc);
        await b.api.command(action);
        assert.equal(m.bootStep,0,action+' pauses before boot LOAD');
        assert.equal(b.toolbar.at(-1),false);
        await b.api.command(action);
        assert.equal(m.bootStep,1,action+' resumes boot exactly once');
        b.api.stop();
        await b.api.command('step'); await b.api.command('step');
        assert.equal(m.bootStep,3);
        await b.api.command(action);
        assert.equal(m.dr[1],0,action+' respects entry address before execution');
        assert.equal(pauses.at(-1),m.pc);
        await b.api.command('step');
        assert.equal(m.dr[1],1,'resume executes the paused instruction once');
        opcodes.add(4);
        await b.api.command(action);
        assert.equal(m.dr[1],1,action+' respects universal instruction breakpoints');
        b.api.stop();
    }
    for(const continuous of [false,true]) {
        const b=harness('boot');
        b.scope.continuousRun=continuous; b.scope.runBatchSize=3000;
        await b.api.prepare(true);
        const m=b.instances[0];
        m.bootComplete=true;
        m.step=function(){this.pc++;this.dr[1]++;return {pc:this.pc};};
        await b.api.command('run');
        // Changes apply to the next Run, not the current one.
        b.scope.continuousRun=!continuous;
        while(m.dr[1]<12000 && b.timers.length) b.timers.shift()();
        assert.equal(m.dr[1],continuous?12000:10000);
        assert.equal(b.toolbar.at(-1),continuous);
        b.api.stop();
        const stopped=m.dr[1];
        while(b.timers.length) b.timers.shift()();
        assert.equal(m.dr[1],stopped,'queued Run callbacks cannot outlive Stop');
        await b.api.command('run');
        const old=m.dr[1];
        await b.api.command('reset');
        while(b.timers.length) b.timers.shift()();
        assert.equal(m.dr[1],old,'Reset invalidates old Run callbacks');
        assert.equal(b.instances.at(-1).bootStep,0);
    }
    const suspended=harness('boot');
    await suspended.api.prepare(true);
    const waiting=suspended.instances[0];
    waiting.bootComplete=true;
    waiting.step=()=>{waiting.dr[1]++;return {suspended:true};};
    await suspended.api.command('run');
    assert.equal(waiting.dr[1],1,'a suspended instruction ends the batch immediately');
    assert.equal(suspended.timers.length,0);
    assert.equal(suspended.toolbar.at(-1),false);
    for(const action of ['step','walk','run']) {
        const boot=harness('boot');
        await boot.api.command(action);
        assert.equal(boot.instances[0].bootStep,1);
        assert.equal(boot.instances[0].dr[1],0);
        for(let n=2;n<=3;n++){
            if(action==='step') await boot.api.command('step');
            else boot.timers.shift()();
            assert.equal(boot.instances[0].bootStep,n);
            assert.equal(boot.instances[0].dr[1],0,'boot must not fast-forward into program execution');
        }
        boot.api.stop();
        for(const timer of boot.timers) timer();
        assert.equal(boot.instances[0].dr[1],0,'Stop cancels the transition into program execution');
        await boot.api.command('reset');
        assert.equal(boot.instances.at(-1).bootStep,0);
        assert.equal(boot.instances.at(-1).bootComplete,false,'Reset returns to the real boot boundary');
    }
    for(const action of ['walk','run']) {
        const paused=harness('boot');
        await paused.api.command(action);
        assert.equal(paused.instances[0].bootStep,1);
        await paused.api.command('stop');
        const atStop=paused.instances[0].bootStep;
        for(const timer of paused.timers) timer();
        assert.equal(paused.instances[0].bootStep,atStop,
            'no queued boot stage may execute after the Stop handler');
    }
    const h=harness();
    assert.equal(await h.api.prepare(true),true);
    assert.equal(h.instances.length,1);
    assert.deepEqual(h.calls.map(s=>s.split('/').pop()),['prepare','approve','activate']);
    h.api.step();assert.equal(h.instances[0].dr[1],1);
    const output=[],notices=[];
    h.scope.appendOutput=(text,type)=>output.push({text,type});
    h.scope._showFpgaToast=(title,text)=>notices.push({title,text});
    h.instances[0].output='Program output';
    h.instances[0].faultLog.push({message:'Read permission denied'});
    h.api.step();
    assert(output.some(entry=>entry.text==='Program output'));
    assert(output.some(entry=>entry.type==='error' && entry.text.includes('Read permission denied')));
    assert.equal(notices.length,1,'fault remains visible without the internal testing panel');
    h.api.step();
    assert.equal(notices.length,1,'repeated renders do not repeat a reported fault');
    h.api.reset();assert.equal(h.instances.length,2);assert.equal(h.instances[1].dr[1],0);
    const routed=harness();
    const viewChanges=[];
    const originalSimulator=routed.scope.sim,frames=[],trace=[],normalTrace=[];
    routed.scope.updateDashboard=()=>frames.push({sim:routed.scope.sim,pc:routed.scope.sim.pc});
    routed.scope.updateThreadControl=()=>{};
    routed.scope._wukongRecordSimulatorStep=result=>trace.push(result);
    routed.scope._traceRecordStep=result=>normalTrace.push(result);
    routed.scope._onSimFaultSnapshot=()=>{};
    routed.scope.switchView=view=>viewChanges.push(view);
    assert.equal(await routed.api.command('step'),true);
    assert.equal(routed.instances[0].dr[1],1,'main control executes admitted selected image');
    assert.equal(viewChanges.length,0,'execution does not redirect to an internal testing view');
    assert.equal(routed.scope.sim,routed.instances[0],'normal displays use the executed machine');
    assert.equal(frames.at(-1).pc,routed.instances[0].pc);
    assert.equal(normalTrace.length,1,'normal trace follows the active machine');
    assert.equal(trace.length,1,'optional simulator-follow trace remains separate');
    assert.equal(routed.instances[0].listeners.faultSnapshot.length,1,'normal fault panel is connected');
    routed.instances[0].halted=true;
    const haltedPC=routed.instances[0].pc;
    assert.equal(await routed.api.command('step'),false);
    assert.equal(routed.instances[0].pc,haltedPC);
    assert.match(routed.api.markup(),/halted.*Reset/);
    assert.equal(await routed.api.command('reset'),true);
    assert.equal(routed.scope.sim,routed.instances.at(-1),'Reset updates the display machine too');
    assert.equal(await routed.api.command('step'),true);
    routed.api.invalidate();
    assert.equal(routed.scope.sim,originalSimulator,'leaving the selected runtime restores the prior observer');
    const rejected=harness('rejected');
    assert.equal(await rejected.api.command('run'),false);
    assert.equal(rejected.instances.length,0,'failed admission cannot run a legacy image');
    const mismatch=harness();
    mismatch.scope._editorSavedBinaryReceipt={token:'old',filename:'old.lump',binary_hash:'old'};
    mismatch.scope.document.getElementById=id=>id==='editor'?{classList:{contains:()=>true}}:null;
    assert.equal(await mismatch.api.command('step'),false);
    assert.equal(mismatch.calls.length,0,'view mismatch cannot prepare another target');
    const stopped=harness();
    const pendingStep=stopped.api.command('step');
    assert.equal(stopped.toolbar.at(-1),true,'main Stop remains reachable while preparing');
    stopped.api.stop();
    assert.equal(stopped.toolbar.at(-1),false,'Stop releases toolbar before response returns');
    assert.equal(await pendingStep,false);
    assert.equal(stopped.toolbar.at(-1),false,'main Run returns after canceled preparation');
    assert(stopped.instances.every(machine=>machine.dr[1]===0),'Stop cancels pending execution');
    assert.equal(stopped.calls.length,1,'canceled preparation cannot approve or activate');
    const walking=harness();
    await walking.api.command('walk');
    assert.equal(walking.toolbar.at(-1),true,'main Stop is visible during selected Walk');
    walking.api.stop();
    assert.equal(walking.toolbar.at(-1),false,'main Run returns after selected Stop');
    const leaving=harness();
    const pendingLeave=leaving.api.command('step');
    leaving.api.stop(); // setProfile stops first, before changing active
    leaving.scope.NamespaceDesignV1.state.active=false;
    assert.equal(leaving.toolbar.at(-1),false,'profile exit immediately releases pending Stop');
    assert.equal(await pendingLeave,false);
    assert.equal(leaving.toolbar.at(-1),false,'leaving design mode releases its pending Stop button');
    // An old completion must not clear the newer preparation's busy/toolbar
    // state or admit the canceled bytes.
    const race=harness();
    const originalFetch=race.scope.fetch, releases=[];
    race.scope.fetch=async(...args)=>{
        const response=await originalFetch(...args);
        if(args[0].endsWith('/prepare')) await new Promise(resolve=>releases.push(resolve));
        return response;
    };
    const oldCommand=race.api.command('step');
    await Promise.resolve();
    race.api.stop();
    const newCommand=race.api.command('step');
    await Promise.resolve();
    releases[0]();
    assert.equal(await oldCommand,false);
    assert.equal(race.toolbar.at(-1),true,'old response cannot release newer toolbar ownership');
    assert.equal(race.instances.length,0);
    releases[1]();
    assert.equal(await newCommand,true);
    assert.equal(race.instances.length,1);
    assert.equal(race.instances[0].dr[1],1);
    h.scope.NamespaceDesignV1.state.profile='phase1';
    h.api.step();assert.equal(h.instances[1].dr[1],0,'selection drift blocks execution');
    assert.match(h.api.markup(),/selected design has changed/);
    for(const defect of ['changed','bytes','rejected']) {
        const bad=harness(defect);
        await assert.rejects(bad.api.prepare(true));
        assert.equal(bad.instances.length,0);
        assert.match(bad.panel.innerHTML,/blocked/);
    }
    const pending=harness();
    const started=pending.api.prepare(true);
    pending.api.invalidate();
    await assert.rejects(started,/changed/);
    assert.equal(pending.instances.length,0);
    console.log('PASS admitted private design UI: ordering, exact bytes, detached runtime, reset, failed admission and stale selection');
})().catch(e=>{console.error(e);process.exitCode=1;});
