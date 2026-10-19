'use strict';
const assert=require('node:assert/strict'), fs=require('fs'), vm=require('vm');
const code=fs.readFileSync(__dirname+'/lump-save-realignment.js','utf8');
require('./test_lump_save_realignment_status.js');
const {_lumpSaveRequest}=require('./lump_save_handler.js');
const responseFor = data => ({ok:true,status:200,json:async()=>data,text:async()=>JSON.stringify(data)});
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
function harness(fail, records=[artifact]) {
    const calls=[], state={abstractions:[row,{slot:6,name:'SelfTest',filename:'self.lump'}],namespaceFingerprint:'b'.repeat(64)};
    const storage = new Map();
    const context={console,setTimeout,window:null,
        sessionStorage:{getItem:key=>storage.get(key)||null,
            setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
        stopSim(){calls.push('stop');},finishWalk(){},renderLumps:async()=>calls.push('render'),
        showLumpDetail(token,options){calls.push(['show',token,options.assignedLump.filename]);},
        _switchLumpTab(token,tab){calls.push(['tab',token,tab]);},_lumpTokenIdentity:x=>x,
        SimulationPreparation:Object.fromEntries(['prepare','approve','activate'].map(action=>[action,async()=>{calls.push(action);return action!==fail;}])),
        fetch:async(url,options)=>{
            calls.push(url);
            if(url.includes('/list'))return {ok:true,json:async()=>records};
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
    // A committed save refreshes History before either early-return failure:
    // binary reload and dashboard/editor refresh. Run the real callback.
    const runSource=fs.readFileSync(__dirname+'/app-run.js','utf8');
    const callbackStart=runSource.indexOf('async function(resp) {',
        runSource.indexOf("return _lumpSaveRequest(fetch, '/api/lumps/save'"));
    const callbackEnd=runSource.indexOf('\n        }, {',callbackStart);
    assert(callbackStart>=0 && callbackEnd>callbackStart);
    for (const failure of ['reload','dashboard']) {
        const calls=[];
        const ctx={console:{error(){}},window:null,label:'ide.CapabilityTest',
            _svPayload:{metadata:{}},_svLang:'clooms',_caps:[],
            _setSaveNSFeedback(){},_persistSaveOperationStatus(){},closeSaveDialog(){},
            _showFpgaToast(){},appendOutput(){},
            _reloadCommittedLumpArtifact:async()=>{calls.push('reload');if(failure==='reload')throw Error('reload failed');},
            updateDashboard(){calls.push('dashboard');throw Error('dashboard failed');},
            LumpSaveRealignment:{refreshHistory:async()=>calls.push('history'),begin(){}}
        };
        ctx.window=ctx;vm.createContext(ctx);
        const callback=vm.runInContext('('+runSource.slice(callbackStart,callbackEnd)+'\n})',ctx);
        global.window=ctx;
        try {
            await _lumpSaveRequest(async()=>responseFor({
                ok:true,token:artifact.token,lump:artifact.filename
            }),'/api/lumps/save',{binary:[0],metadata:{}},callback);
        } finally {delete global.window;}
        assert.equal(calls[0],'history',failure+' must not skip History');
        assert(calls.includes(failure));
    }
    // Automatic callers omit onCommit. A transport-lost acknowledgement also
    // enters the same committed-History path after server reconciliation.
    for (const recovered of [false,true]) {
        const saved={ok:true,token:artifact.token,lump:artifact.filename,digest:artifact.binary_hash};
        const seen=[];
        global.window={LumpSaveRealignment:{refreshHistory:async response=>seen.push(response)}};
        try {
            const result=await _lumpSaveRequest(async(url,options)=>{
                if(recovered && options.method==='POST')throw Error('lost acknowledgement');
                return responseFor(recovered ? {committed:true,response:saved}:saved);
            },'/api/lumps/save',{binary:[0],metadata:{}});
            assert.deepEqual(result,saved);
            assert.deepEqual(seen,[saved],'automatic/reconciled save refreshes exact History once');
        } finally {delete global.window;}
    }
    let callbackAfterFailure=false;
    global.window={LumpSaveRealignment:{refreshHistory:async()=>{throw Error('History offline');}}};
    try {
        const saved=await _lumpSaveRequest(async()=>responseFor({
            ok:true,token:artifact.token,lump:artifact.filename
        }),'/api/lumps/save',{binary:[0],metadata:{}},()=>{callbackAfterFailure=true;});
        assert.equal(saved.history_refresh_error,'History offline');
        assert(callbackAfterFailure,'History errors cannot turn a committed save into a failed transaction');
    } finally {delete global.window;}
    // Tab lookup must honor the exact displayed artifact, even with no cache
    // record, and expose its pending load rather than return before History.
    const {JSDOM}=require('jsdom');
    const dom=new JSDOM('<div id="lumpsDetailContent"></div><div id="lumpHistoryBody_12345678"></div>');
    dom.window.document.getElementById('lumpsDetailContent')._displayedLump=artifact;
    let resolveHistory, historyCalls=0;
    const loading=new Promise(resolve=>{resolveHistory=resolve;});
    const tabs={document:dom.window.document,_lumpActiveTab:{},_lumpTimelineLoaded:{},
        _lumpsCache:[],_lumpTokenIdentity:x=>x,
        _fetchAndShowLumpTimeline(token,lump){historyCalls++;assert.equal(lump,artifact);return loading;}};
    vm.createContext(tabs);
    vm.runInContext(detailSource.slice(detailSource.indexOf('function _switchLumpTab('),
        detailSource.indexOf('const _dnaRendered')),tabs);
    assert.equal(tabs._switchLumpTab(artifact.token,'history'),loading);
    assert.equal(tabs._switchLumpTab(artifact.token,'history'),loading);
    assert.equal(historyCalls,1);
    resolveHistory();await loading;
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
    const response={token:artifact.token,lump:artifact.filename,digest:artifact.binary_hash,
        lump_version:artifact.lump_version};
    await h.api.realign(response,{});
    assert.equal(h.context._savedLumpRealignment,null);
    assert.equal(h.context._nsState.abstractions[0].filename,artifact.filename);
    assert(h.calls.indexOf('stop')<h.calls.indexOf('prepare'));
    assert(h.calls.indexOf('prepare')<h.calls.indexOf('approve'));
    assert(h.calls.indexOf('approve')<h.calls.indexOf('activate'));
    assert(h.calls.some(c=>Array.isArray(c)&&c[0]==='tab'&&c[2]==='history'));
    // An older catalog server may still attach a shared approval's current
    // filename to an archived row. Only the exact active version is eligible.
    const repeated=harness(null,[{...artifact,archived:true,lump_version:2},artifact]);
    await repeated.api.realign(response,{});
    assert.equal(repeated.context._savedLumpRealignment,null);
    assert(repeated.calls.includes('activate'));
    for (const records of [[], [{...artifact,archived:true}],
        [{...artifact,lump_version:4}], [artifact,{...artifact}]]) {
        const ambiguous=harness(null,records);
        await assert.rejects(ambiguous.api.realign(response,{}),/Refresh the LUMP library and retry/);
        assert(!ambiguous.calls.includes('/api/namespace/save-table'));
        assert(!ambiguous.calls.includes('prepare'));
        const retained=JSON.parse(ambiguous.context.sessionStorage.getItem('savedLumpRealignment'));
        assert.equal(retained.pending,false);
        assert.equal(retained.retryInput.response.lump_version,artifact.lump_version,
            'retry must not adopt a later unchanged save sharing the filename/hash');
        assert.match(retained.message,/LUMP saved; realignment incomplete/);
    }
    const legacy=harness();
    const {lump_version,...legacyResponse}=response;
    await legacy.api.realign(legacyResponse,{});
    assert.equal(legacy.context._savedLumpRealignment,null);
    for(const failure of ['namespace','prepare','approve','activate']) {
        const failed=harness(failure);
        await assert.rejects(failed.api.realign(response,{}));
        assert(failed.context._savedLumpRealignment);
        assert(failed.calls.some(c=>Array.isArray(c)&&c[0]==='show'),'History still follows committed save');
    }
    const design=harness();
    design.context.NamespaceDesignV1={state:{active:true,document:{rows:[{slot:10,name:row.name,selection:{filename:row.filename}}]}},
        advanceSavedRevision:async rows=>{design.context.NamespaceDesignV1.state.document.rows=rows;}};
    await assert.rejects(design.api.realign(response,{}),/Validated design simulation admission/);
    assert.equal(design.context.NamespaceDesignV1.state.document.rows[0].selection.filename,artifact.filename);
    assert(!design.calls.includes('activate'),'no bypass of unapproved design profile boundary');
    design.context.DesignSimulation={invalidate(){},async prepare(throwOnError){
        assert.equal(throwOnError,true);design.calls.push('design-admission');return true;
    }};
    await design.api.realign(response,{});
    assert(design.calls.includes('design-admission'));
    assert.equal(design.context._savedLumpRealignment.privateReady,true);
    assert(!design.calls.includes('activate'),'legacy simulation must remain separate');
    console.log('PASS save realignment: exact revision, history, Namespace preservation, ordered activation, failure barrier, and design boundary');
})().catch(e=>{console.error(e);process.exitCode=1;});
