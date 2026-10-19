'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const code=fs.readFileSync(__dirname+'/design-simulation.js','utf8');
const scripts=[...fs.readFileSync(__dirname+'/index.html','utf8').matchAll(/<script src="([^"?]+)/g)].map(m=>m[1]);
assert(scripts.indexOf('namespace-runtime-core.js') < scripts.indexOf('design-simulation.js'));
assert(scripts.indexOf('design-simulation.js') < scripts.indexOf('namespace-design-v1.js'));
function harness(defect) {
    const panel={innerHTML:''},calls=[],instances=[];
    const words=[0xf8810100,0,2,0], profile='ascending', fingerprint='a'.repeat(64);
    const hash=require('node:crypto').createHash('sha256').update(Buffer.from(new Uint32Array(words).buffer)).digest('hex');
    const review={preparationId:'ticket',configurationHash:'b'.repeat(64),imageHash:hash,
        designProfile:profile,sourceNamespaceFingerprint:fingerprint,hardwareCertified:false,
        imageFormat:'ascending-nst-metadata-slot0-v1',slotCount:64,artifactBindings:[{filename:'exact.lump'}]};
    const scope={console,setTimeout,Uint32Array,Uint8Array,ArrayBuffer,DataView,crypto:webcrypto,
        NamespaceDesignV1:{state:{active:true,profile,fingerprint,document:{rows:[]},dirty:false}},
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
    return {api:scope.DesignSimulation,scope,calls,instances,panel};
}
(async()=>{
    const h=harness();
    assert.equal(await h.api.prepare(true),true);
    assert.equal(h.instances.length,1);
    assert.deepEqual(h.calls.map(s=>s.split('/').pop()),['prepare','approve','activate']);
    h.api.step();assert.equal(h.instances[0].dr[1],1);
    h.api.reset();assert.equal(h.instances.length,2);assert.equal(h.instances[1].dr[1],0);
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
