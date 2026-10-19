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
    const completeReport=JSON.parse(JSON.stringify(result.bindingReport));
    let writes=0,shows=0,fail=false,nodeSaved=true;
    w.fetch=async(url,options)=>{
        assert.equal(options.method,'PUT');
        writes++;
        if(fail) throw Error('Namespace design changed in another tab');
        return {ok:true,json:async()=>JSON.parse(JSON.stringify(result))};
    };
    w.NamespaceIdeNode={savePending:async()=>nodeSaved};
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
    // Close the dialogs, then repeat Bind with no changes: it must fetch
    // fresh evidence and recreate every popup, rather than skip a clean draft.
    w.NamespaceBindingWindows.closeAll();
    await api.save();
    assertWindows();
    assert.equal(shows,3);
    assert.equal(writes,3);
    result.bindingReport.status='unresolved';
    await api.advanceSavedRevision(rows);
    assert(api.state.error.includes('unresolved'));
    delete result.bindingReport;
    await api.advanceSavedRevision(rows);
    assert(api.state.error.includes('binding results are unavailable'));
    assert.equal(shows,5,'missing report opens blocked results, never stale success');
    assert.equal(w.document.querySelectorAll('.nsbw-blocked').length,3);
    fail=true;
    w.NamespaceBindingWindows.closeAll();
    await api.save();
    assert.equal(w.document.querySelectorAll('.nsbw-win').length,3);
    assert(w.document.querySelector('.nsbw-reason').textContent.includes('changed in another tab'));
    assert.equal(api.state.saving,false);
    const before=writes;
    nodeSaved=false;
    w.NamespaceBindingWindows.closeAll();
    await api.save();
    assert.equal(writes,before,'cancelled IDE node save never writes Namespace');
    assert.equal(w.document.querySelectorAll('.nsbw-blocked').length,3);
    assert(w.document.querySelector('.nsbw-reason').textContent.includes('Binding did not run'));
    // Exercise the rendered button as well as the API methods: rendering
    // replaces the button, so each new element must retain its click handler.
    fail=false;nodeSaved=true;
    result.bindingReport=completeReport;
    result.projection={rows:[],warnings:[]};
    api.state.projection=result.projection;
    w._nsRenderSavedVersionCell=()=>'<td>test revision</td>';
    const host=w.document.createElement('div');
    host.id='namespaceTable';w.document.body.appendChild(host);
    w.updateNamespace=()=>api.renderRows(
        '<button id="nsSaveBtn"></button><span id="nsBoltDrag"></span><table><tbody>',host);
    api.render();
    assert(!host.textContent.includes('Open corrected SelfTest source'));
    assert(!host.textContent.includes('not installed'));
    assert.equal(host.querySelector('#designSimulationPanel'),null);
    for(let i=0;i<3;i++){
        w.NamespaceBindingWindows.closeAll();
        const count=writes;
        w.document.getElementById('nsSaveBtn').click();
        assert.equal(w.document.getElementById('nsSaveBtn').textContent,'Binding…');
        await new Promise(resolve=>setImmediate(resolve));
        assertWindows();
        assert.equal(writes,count+1);
    }
    dom.window.close();
    console.log('PASS both saved-design paths show all three binding dialogs including SelfTest, once per save');
})().catch(error=>{console.error(error);process.exitCode=1;});
