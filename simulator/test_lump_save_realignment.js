'use strict';
const assert=require('node:assert/strict'), fs=require('fs'), vm=require('vm');
const code=fs.readFileSync(__dirname+'/lump-save-realignment.js','utf8');
// Rebuilding a same-token detail view must discard the old History load flag.
const detailSource=fs.readFileSync(__dirname+'/app-lumps.js','utf8');
const resetStart=detailSource.indexOf('    const _prevTab =');
const resetEnd=detailSource.indexOf('    // ── Lump header strip',resetStart);
assert(resetStart>=0 && resetEnd>resetStart);
const resetContext={_tk:'saved',_lumpActiveTab:{saved:'history'},
    _lumpContentLoaded:{saved:true},_lumpTimelineLoaded:{saved:true},
    _lumpHexLoaded:{saved:true},_lumpTokensLoaded:{saved:true}};
vm.runInNewContext(detailSource.slice(resetStart,resetEnd),resetContext);
assert.equal(resetContext._lumpTimelineLoaded.saved,undefined);
const artifact={abstraction:'ide.CapabilityTest',token:'12345678',filename:'ide.CapabilityTest.1.new.lump',binary_hash:'a'.repeat(64),lump_version:3};
const row={slot:10,name:'CapabilityTest',token:'87654321',filename:'old.lump',boot:true,location:1296,limit:1024,seq:4};
function harness(fail) {
    const calls=[], state={abstractions:[row,{slot:6,name:'SelfTest',filename:'self.lump'}],namespaceFingerprint:'b'.repeat(64)};
    const context={console,setTimeout,window:null,
        stopSim(){calls.push('stop');},finishWalk(){},renderLumps:async()=>calls.push('render'),
        showLumpDetail(token,options){calls.push(['show',token,options.assignedLump.filename]);},
        _switchLumpTab(token,tab){calls.push(['tab',token,tab]);},_lumpTokenIdentity:x=>x,
        SimulationPreparation:Object.fromEntries(['prepare','approve','activate'].map(action=>[action,async()=>{calls.push(action);return action!==fail;}])),
        fetch:async(url,options)=>{
            calls.push(url);
            if(url.includes('/list'))return {ok:true,json:async()=>[artifact]};
            if(url.includes('/ns-state'))return {ok:true,json:async()=>state};
            if(fail==='namespace')return {ok:false,json:async()=>({error:'conflict'})};
            const submitted=JSON.parse(options.body);
            assert.equal(submitted.namespaceFingerprint,state.namespaceFingerprint);
            return {ok:true,json:async()=>({ok:true,abstractions:submitted.ns_state.abstractions,namespaceFingerprint:'c'.repeat(64)})};
        }};
    context.window=context; vm.createContext(context);vm.runInContext(code,context);
    return {context,calls,state,api:context.LumpSaveRealignment};
}
(async()=>{
    const h=harness();
    const original=JSON.stringify(h.state);
    const result=h.api.replacementRows(h.state.abstractions,artifact,{},false);
    assert.equal(result.rows[0].filename,artifact.filename);
    assert.equal(result.rows[0].name,artifact.abstraction);
    assert.equal(result.rows[0].boot,true);
    assert.equal(result.rows[0].location,row.location);
    assert.equal(result.rows[0].seq,row.seq);
    assert.equal(result.rows[1],h.state.abstractions[1]);
    assert.equal(JSON.stringify(h.state),original);
    assert.equal(h.api.replacementRows([row],artifact,{save_as_copy:true},false).slots.length,0);
    assert.throws(()=>h.api.replacementRows([row,{...row,slot:11}],artifact,{},false),/Several/);
    const response={token:artifact.token,lump:artifact.filename,digest:artifact.binary_hash};
    await h.api.realign(response,{});
    assert.equal(h.context._savedLumpRealignment,null);
    assert.equal(h.context._nsState.abstractions[0].filename,artifact.filename);
    assert(h.calls.indexOf('stop')<h.calls.indexOf('prepare'));
    assert(h.calls.indexOf('prepare')<h.calls.indexOf('approve'));
    assert(h.calls.indexOf('approve')<h.calls.indexOf('activate'));
    assert(h.calls.some(c=>Array.isArray(c)&&c[0]==='tab'&&c[2]==='history'));
    for(const failure of ['namespace','prepare','approve','activate']) {
        const failed=harness(failure);
        await assert.rejects(failed.api.realign(response,{}));
        assert(failed.context._savedLumpRealignment);
        assert(failed.calls.some(c=>Array.isArray(c)&&c[0]==='show'),'History still follows committed save');
    }
    const design=harness();
    design.context.NamespaceDesignV1={state:{active:true,document:{rows:[{slot:10,name:row.name,selection:{filename:row.filename}}]}},
        advanceSavedRevision:async rows=>{design.context.NamespaceDesignV1.state.document.rows=rows;}};
    await assert.rejects(design.api.realign(response,{}),/validated simulation admission/);
    assert.equal(design.context.NamespaceDesignV1.state.document.rows[0].selection.filename,artifact.filename);
    assert(!design.calls.includes('activate'),'no bypass of unapproved design profile boundary');
    console.log('PASS save realignment: exact revision, history, Namespace preservation, ordered activation, failure barrier, and design boundary');
})().catch(e=>{console.error(e);process.exitCode=1;});
