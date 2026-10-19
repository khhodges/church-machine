'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const code=fs.readFileSync(__dirname+'/design-simulation.js','utf8');
const scripts=[...fs.readFileSync(__dirname+'/index.html','utf8').matchAll(/<script src="([^"?]+)/g)].map(m=>m[1]);
assert(scripts.indexOf('namespace-runtime-core.js') < scripts.indexOf('design-simulation.js'));
assert(scripts.indexOf('design-simulation.js') < scripts.indexOf('namespace-design-v1.js'));
function harness(defect) {
    const panel={innerHTML:''},calls=[],instances=[];
    const toolbar=[];
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
            const machine={pc:1,dr:Array(16).fill(0),faultLog:[],halted:false,
                startEntryThread(){return true;},step(){this.pc++;this.dr[1]++;this.halted=this.dr[1]===3;}};
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
    scope.window=scope;vm.createContext(scope);vm.runInContext(code,scope);
    return {api:scope.DesignSimulation,scope,calls,instances,panel,toolbar};
}
(async()=>{
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
    routed.scope.switchView=view=>viewChanges.push(view);
    assert.equal(await routed.api.command('step'),true);
    assert.equal(routed.instances[0].dr[1],1,'main control executes admitted selected image');
    assert.equal(viewChanges.length,0,'execution does not redirect to an internal testing view');
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
