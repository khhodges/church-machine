'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {TextDecoder}=require('node:util');
(async()=>{
    const w=new JSDOM('',{url:'https://ide.example',runScripts:'outside-only'}).window;
    w.TextDecoder=TextDecoder;
    w.NamespaceProfileNames={label:x=>x};
    w.NamespaceIdeNode={savePending:async()=>true};
    for(const file of ['namespace-binding-windows.js','namespace-design-v1.js'])
        w.eval(fs.readFileSync(__dirname+'/'+file,'utf8'));
    const api=w.NamespaceDesignV1, item={slot:21,name:'ide.AmoebaStartup',rows:[]};
    Object.assign(api.state,{document:{rows:[]},fingerprint:'old'});
    const events=[
        {type:'started'},
        {type:'binding',total:1,item:{...item,status:'binding'}},
        {type:'entry',total:1,item:{...item,status:'bound'}},
        {type:'result',result:{ok:true,document:{rows:[]},fingerprint:'new',persisted:true,
            bindingReport:{status:'complete',installed:false,lists:[{...item,status:'bound'}]}}}
    ];
    let index=0, reads=0;
    w.fetch=async(url,opts)=>{
        assert.equal(opts.headers.Accept,'application/x-ndjson');
        return {ok:true,headers:{get:()=> 'application/x-ndjson'},body:{getReader:()=>({
            async read(){
                if(index===2) assert(w.document.querySelector('.nsbw-binding'),'window appears before completion');
                if(index===3) {
                    assert(w.document.querySelector('.nsbw-bound'));
                    assert.equal(w.document.querySelectorAll('.nsbw-win').length,1,'updates same window');
                }
                reads++;
                return index<events.length ? {value:Buffer.from(JSON.stringify(events[index++])+'\n'),done:false} : {done:true};
            },releaseLock(){}
        })}};
    };
    await api.save(true);
    assert.equal(reads,5);
    assert.equal(api.state.fingerprint,'new');
    assert.equal(api.state.saving,false);
    assert(api.state.error.includes('Binding checks passed'));
    console.log('PASS progressive binding windows and final save confirmation');
})().catch(e=>{console.error(e);process.exitCode=1;});
