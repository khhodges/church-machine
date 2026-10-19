'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

(async()=>{
    const dom=new JSDOM('',{url:'https://ide.example/simulator/',runScripts:'outside-only'});
    const w=dom.window;
    const rows=[
        {slot:6,name:'SelfTest',kind:'lump'},
        {slot:7,name:'ide.WukongCallHome',kind:'lump'},
        {slot:10,name:'ide.CapabilityTest',kind:'lump'}
    ];
    let result={ok:true,document:{rows},fingerprint:'new',persisted:true,projection:{},
        bindingReport:{fingerprint:'new',status:'complete',installed:false,
            lists:rows.map(row=>({...row,status:'bound',rows:[
                {index:0,name:'SELF',newGT:0x4a000000+row.slot,targetSlot:row.slot,permissions:'E',status:'bound'}
            ]}))}};
    let writes=0,shows=0;
    w.fetch=async(url,options)=>{
        assert.equal(options.method,'PUT');
        writes++;
        return {ok:true,json:async()=>JSON.parse(JSON.stringify(result))};
    };
    w.NamespaceIdeNode={savePending:async()=>true};
    w.eval(fs.readFileSync(__dirname+'/namespace-binding-windows.js','utf8'));
    const show=w.NamespaceBindingWindows.show;
    w.NamespaceBindingWindows.show=report=>{shows++;return show(report);};
    w.eval(fs.readFileSync(__dirname+'/namespace-design-v1.js','utf8'));
    const api=w.NamespaceDesignV1;
    Object.assign(api.state,{document:{rows},fingerprint:'old',dirty:false});
    function assertWindows(){
        assert.equal(w.document.querySelectorAll('.nsbw-win').length,3);
        assert(Array.from(w.document.querySelectorAll('.nsbw-title h2'))
            .some(el=>el.textContent==='C-list slot 6 — SelfTest'));
        assert.equal(api.state.error,'');
    }
    await api.advanceSavedRevision(rows);
    assertWindows();
    assert.equal(shows,1,'revision advancement presents the complete report once');
    await api.save();
    assertWindows();
    assert.equal(shows,2,'ordinary Bind uses the same presentation once');
    assert.equal(writes,2);
    result.bindingReport.status='unresolved';
    await api.advanceSavedRevision(rows);
    assert(api.state.error.includes('unresolved'));
    delete result.bindingReport;
    await api.advanceSavedRevision(rows);
    assert(api.state.error.includes('binding results are unavailable'));
    assert.equal(shows,3,'missing report is not silently rendered as success');
    dom.window.close();
    console.log('PASS both saved-design paths show all three binding dialogs including SelfTest, once per save');
})().catch(error=>{console.error(error);process.exitCode=1;});
