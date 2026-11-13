'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/namespace-design-v1.js','utf8');
const context={endpoint:'/api/namespace/design-v1',state:{profile:'ascending',designId:'boot2'},
    designQuery:()=> '&design=boot2',root:{}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('    async function request(method, body)'),
    source.indexOf('    function accept(data)')),context);
(async()=>{
    for(const [payload,expected] of [
        [{error:'change_preflight_failed',message:'Prepared Thread driver and actor must name declared LUMP rows'},'Prepared Thread driver and actor must name declared LUMP rows'],
        [{error:'Keep exactly one selected boot target'},'Keep exactly one selected boot target'],
        [{},'Namespace design request failed'],
    ]){
        context.fetch=async()=>({ok:false,json:async()=>payload});
        await assert.rejects(context.request('PUT',{bind:true,document:{}}),error=>error.message===expected);
    }
    const result={ok:true,document:{rows:[]}};
    context.fetch=async()=>({ok:true,json:async()=>result});
    assert.equal(await context.request('GET'),result);
    console.log('PASS Namespace request errors preserve validation details and legacy errors');
})().catch(error=>{console.error(error);process.exitCode=1;});
