'use strict';
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/app-lumps.js','utf8');
const start=source.indexOf('    if (options && options.confirmReplacement &&');
const end=source.indexOf('// ── Transfer editor ownership',start);
assert(start>=0 && end>start);
async function check(current,target,expected) {
    let confirmations=0;
    const ctx={options:{confirmReplacement:true,namespaceAssignedOnly:true},
        window:{_editorOpenLumpToken:current,confirmSourceReplacement:async()=>{confirmations++;return true;}},
        token:target,_sameLumpToken:(a,b)=>a===b,
        document:{getElementById:()=>({value:'SelfTest draft'})},
        _navigationBuffer:null,_editableSourceAvailable:false,_recoveredSource:'',
        _openWriteGuard:{accepts:()=>true},_exactSelection:{filename:'Alice.lump'}};
    await vm.runInNewContext('(async()=>{'+source.slice(start,end)+'})()',ctx);
    assert.equal(confirmations,expected);
}
(async()=>{
    await check('selftest','alice',0);
    await check(null,'alice',0);
    await check('alice','alice',1);
    console.log('PASS cross-document Namespace navigation is not a source replacement');
})().catch(e=>{console.error(e);process.exitCode=1;});
