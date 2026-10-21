'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<textarea id="asmEditor"></textarea>',{runScripts:'outside-only'});
const w=dom.window, editor=w.document.getElementById('asmEditor');
const opens=[];
w.NamespaceProfileNames=require('./namespace-profile-names');
w.updateNamespace=()=>{};
w._captureEditorWriteGuard=()=>{const text=editor.value;return {accepts:()=>editor.value===text};};
w._nsOpenDesignSelection=async(...args)=>opens.push(args);
w.openSourceFile=()=>{throw Error('Namespace must not open standalone files');};
w.eval(fs.readFileSync(__dirname+'/namespace-design-v1.js','utf8'));
const api=w.NamespaceDesignV1;
api.state.projection={rows:[],warnings:[]};
const selection={token:'4a000006',filename:'Old.lump',binaryHash:'a'.repeat(64),revision:98};
(async()=>{
    for(const profile of ['ascending','phase1']) {
        api.state.profile=profile;
        api.state.document={rows:[{slot:6,name:'SelfTest',kind:'lump',selection,
            authoring:{kind:'source',path:'simulator/examples/other.cloomc'}}]};
        editor.value='owned draft';
        await api.source(6);
        assert.equal(opens.at(-1)[0].selection.filename,'Old.lump');
        assert.equal(opens.at(-1)[2].confirmReplacement,true);
        assert.equal(opens.at(-1)[2].accepts(),true);
        editor.value='later edit';
        assert.equal(opens.at(-1)[2].accepts(),false);
        assert.equal(editor.value,'later edit');
        delete api.state.document.rows[0].authoring;
        await api.assigned(6);
        assert.equal(opens.at(-1)[0].selection.revision,98);
        api.state.document.rows[0].selection={};
        await api.source(6);
        assert.match(w.document.body.textContent,/No LUMP assigned/);
        assert.doesNotMatch(w.document.body.textContent,/Choose authoring target/);
        api.state.document.rows=[{slot:2,name:'Boot.Thread',kind:'thread',words:256}];
        await api.source(2);
        assert.match(w.document.body.textContent,/Thread target/);
    }
    // Independent source files still use File Open, without any LUMP lookup.
    let confirmed=0;
    w.confirmSourceReplacement=async()=>{confirmed++;return true;};
    w.closeOpenFileDialog=()=>{};
    w.fetch=async()=>({ok:true,text:async()=>'; independent file'});
    const shell=fs.readFileSync(__dirname+'/app-shell.js','utf8');
    w.eval(shell.slice(shell.indexOf('function openSourceFile(path, options)'),
        shell.indexOf('// ── Save Source File')));
    await w.openSourceFile('simulator/examples/alice.cloomc');
    assert.equal(editor.value,'; independent file');
    assert.equal(confirmed,1);
    const memory=fs.readFileSync(__dirname+'/app-memory.js','utf8');
    w.eval(memory.slice(memory.indexOf('function _nsLabelOpen('),
        memory.indexOf('// Dedicated read-only popup')));
    api.state.active=false;
    w._nsState={abstractions:[{slot:16,name:'ide.Alice',token:'12345678',
        filename:'Alice.old.lump',binary_hash:'b'.repeat(64),lump_version:3}]};
    w.openLumpInEditor=(token,options)=>{opens.push([token,options]);};
    w._nsLabelOpen(16);
    assert.equal(opens.at(-1)[1].exactSavedArtifact.filename,'Alice.old.lump');
    assert.equal(opens.at(-1)[1].namespaceAssignedOnly,true);
    assert.equal(opens.at(-1)[1].confirmReplacement,true);
    dom.window.close();
    console.log('PASS exact Namespace label targets, missing assignments, draft guards, and independent File Open');
})().catch(e=>{dom.window.close();console.error(e);process.exitCode=1;});
