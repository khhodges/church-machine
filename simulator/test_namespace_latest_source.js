'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const old={abstraction:'SelfTest',token:'4a000006',filename:'Old.lump',
    binary_hash:'a'.repeat(64),lump_version:98,compiled_at:100,binary_valid:true};
const latest={...old,token:'bb1e4bed',filename:'Latest.lump',binary_hash:'b'.repeat(64),
    lump_version:99,compiled_at:200,archived:true};
let catalog=[old,latest], accepts=true, opened=[], pending;
const context={
    document:{readyState:'loading',addEventListener(){},getElementById(){return null;}},
    _captureEditorWriteGuard:()=>({accepts:()=>accepts}),
    _nsOpenDesignSelection:async(...args)=>opened.push(args),
    fetch:async url=>{
        assert.equal(url,'/api/lumps/list?abstraction=SelfTest&include_archived=1');
        if(pending) await pending;
        return {ok:true,json:async()=>catalog};
    }
};
context.window=context; vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname+'/namespace-design-v1.js','utf8'),context);
const api=context.NamespaceDesignV1;
api.state.document={rows:[{slot:6,name:'SelfTest',kind:'lump',selection:{
    token:old.token,filename:old.filename,binaryHash:old.binary_hash}}]};
const before=JSON.stringify(api.state.document);
(async()=>{
    await api.source(6);
    assert.equal(opened[0][0].selection.filename,'Latest.lump');
    assert.equal(opened[0][0].selection.binaryHash,latest.binary_hash);
    assert.equal(JSON.stringify(api.state.document),before,'opening must not change placement');
    catalog=[{...old,lump_version:999},latest]; opened=[];
    await api.source(6);
    assert.equal(opened[0][0].selection.filename,'Latest.lump','compile date outranks revision number');
    catalog=[old,{...latest,binary_valid:false,validation_errors:['bad seal']}];opened=[];
    await api.source(6);
    assert.equal(opened.length,0,'invalid latest must not fall back to older bytes');
    assert.match(api.state.error,/bad seal/);
    let release;
    catalog=[old,latest];pending=new Promise(resolve=>release=resolve);
    const opening=api.source(6); accepts=false; release(); await opening;
    assert.equal(opened.length,0,'navigation during fetch cancels delayed open');
    assert.equal(JSON.stringify(api.state.document),before);
    console.log('PASS latest Namespace source: date order, exact identity, archives, no fallback, stale navigation and unchanged placement');
})().catch(error=>{console.error(error);process.exitCode=1;});
