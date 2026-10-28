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
        assert.equal(url,'/api/namespace/design-v1','binding only saves the design; never activates an image');
        assert.equal(options.method,'PUT');
        writes++;
        if(fail) throw Error('Namespace design changed in another tab');
        return {ok:true,json:async()=>JSON.parse(JSON.stringify(result))};
    };
    w.NamespaceIdeNode={savePending:async()=>nodeSaved};
    // Load the real browser dependencies in served order, including the
    // profile labels used when the save button is rendered again.
    const dependencies=new Set([
        'namespace-profile-names.js','namespace-binding-windows.js','namespace-design-v1.js'
    ]);
    const html=fs.readFileSync(__dirname+'/index.html','utf8');
    const scripts=[...html.matchAll(/<script\b[^>]*src="([^"?]+)(?:\?[^"]*)?"/g)]
        .map(match=>match[1]).filter(name=>dependencies.has(name));
    for(const name of dependencies) assert(scripts.includes(name),`${name} missing from served manifest`);
    assert(scripts.indexOf('namespace-profile-names.js')<scripts.indexOf('namespace-design-v1.js'),
        'profile helpers must be served before the design editor');
    for(const name of scripts) w.eval(fs.readFileSync(__dirname+'/'+name,'utf8'));
    const show=w.NamespaceBindingWindows.show;
    w.NamespaceBindingWindows.show=report=>{
        assert.equal(report.installed,false,'binding reports must not claim activation');
        shows++;return show(report);
    };
    const api=w.NamespaceDesignV1;
    Object.assign(api.state,{document:{rows},fingerprint:'old',dirty:false});
    function assertWindows(){
        assert.equal(w.document.querySelectorAll('.nsbw-win').length,3);
        assert(Array.from(w.document.querySelectorAll('.nsbw-title h2'))
            .some(el=>el.textContent==='C-list slot 6 — SelfTest'));
        assert(api.state.error.includes('Binding checks passed'));
    }
    await api.advanceSavedRevision(rows);
    assert.equal(shows,0,'revision advancement must not bind or present bound evidence');
    assert(api.state.error.includes('no GTs were bound'));
    await api.save(true);
    assertWindows();
    assert.equal(shows,1,'explicit Bind presents the report once');
    assert.equal(writes,2);
    // Close the dialogs, then repeat Bind with no changes: it must fetch
    // fresh evidence and recreate every popup, rather than skip a clean draft.
    w.NamespaceBindingWindows.closeAll();
    await api.save(true);
    assertWindows();
    assert.equal(shows,2);
    assert.equal(writes,3);
    result.bindingReport.status='unresolved';
    await api.save(true);
    assert(api.state.error.includes('unresolved'));
    delete result.bindingReport;
    await api.save(true);
    assert(api.state.error.includes('binding results are unavailable'));
    assert.equal(shows,3,'request failure must not fabricate per-LUMP results');
    assert.equal(w.document.querySelectorAll('.nsbw-win').length,0);
    assert(w.document.querySelector('#namespaceDesignDialog').textContent.includes('binding results are unavailable'));
    fail=true;
    w.NamespaceBindingWindows.closeAll();
    await api.save(true);
    assert.equal(w.document.querySelectorAll('.nsbw-win').length,0);
    assert.equal(w.document.querySelectorAll('#namespaceDesignDialog').length,1);
    assert(w.document.querySelector('#namespaceDesignDialog').textContent.includes('changed in another tab'));
    assert(w.document.querySelector('#namespaceDesignDialog button[onclick="NamespaceDesignV1.reloadSaved()"]'));
    assert.equal(api.state.saving,false);
    const before=writes;
    nodeSaved=false;
    w.NamespaceBindingWindows.closeAll();
    await api.save(true);
    assert.equal(writes,before,'cancelled IDE node save never writes Namespace');
    assert.equal(w.document.querySelectorAll('.nsbw-win').length,0);
    assert(w.document.querySelector('#namespaceDesignDialog').textContent.includes('Binding did not run'));
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
        for(let wait=0;api.state.saving && wait<100;wait++)
            await new Promise(resolve=>setTimeout(resolve,5));
        assertWindows();
        assert.equal(writes,count+1);
    }
    dom.window.close();
    console.log('PASS revision advancement does not bind; explicit Bind and its rendered button show exact results');
})().catch(error=>{console.error(error);process.exitCode=1;});
