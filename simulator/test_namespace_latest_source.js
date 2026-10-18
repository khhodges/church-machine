'use strict';
// Despite the historical filename, "latest" is NOT navigation authority.
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<textarea id="asmEditor"></textarea>',{runScripts:'outside-only'});
const w=dom.window, editor=w.document.getElementById('asmEditor');
let epoch=0, allow=true, pending, confirmations=0, paths=[], opens=[];
w.updateNamespace=()=>{};
w._captureEditorWriteGuard=()=>{
    const mine=++epoch,text=editor.value;
    return {accepts:()=>epoch===mine && editor.value===text};
};
w.confirmSourceReplacement=async()=>{confirmations++;return allow;};
w.closeOpenFileDialog=()=>{};
w.switchView=()=>{};
w._nsOpenDesignSelection=async(...args)=>opens.push(args);
w.fetch=async url=>{
    assert.ok(url.startsWith('/simulator/'), 'label navigation must not query a catalog');
    paths.push(url);
    if(pending) await pending;
    return {ok:true,text:async()=>'unfinished source bytes'};
};
const shell=fs.readFileSync(__dirname+'/app-shell.js','utf8');
w.eval(shell.slice(shell.indexOf('function openSourceFile(path, options)'),
    shell.indexOf('// ── Save Source File')));
w.eval(fs.readFileSync(__dirname+'/namespace-design-v1.js','utf8'));
const api=w.NamespaceDesignV1;
api.state.projection={rows:[],warnings:[]};
const selected={token:'4a000006',filename:'Old.lump',binaryHash:'a'.repeat(64),revision:98};
api.state.document={rows:[{slot:6,name:'SelfTest',kind:'lump',selection:selected,
    authoring:{kind:'source',path:'simulator/examples/custom_unfinished.cloomc'}}]};
const row=api.state.document.rows[0], before=JSON.stringify(api.state.document);
(async()=>{
    editor.value='owned draft'; allow=false;
    await api.source(6);
    assert.equal(editor.value,'owned draft','consent rejection must preserve the draft');
    assert.equal(epoch,1,'one guard handed to real source opener');
    allow=true;await api.source(6);
    assert.equal(editor.value,'unfinished source bytes');
    assert.equal(paths.at(-1),'/simulator/examples/custom_unfinished.cloomc',
        'Namespace path wins even for known names and absent catalog entries');
    assert.equal(confirmations,2);
    await api.assigned(6);
    assert.equal(opens[0][0].selection.filename,'Old.lump');
    assert.equal(opens[0][0].selection.binaryHash,selected.binaryHash);
    assert.equal(opens[0][2].accepts(),true);
    assert.equal(JSON.stringify(api.state.document),before,'navigation preserves the exact placement');
    for(const invalidate of [
        ()=>{editor.value='typing during fetch';},
        ()=>{row.authoring.path='simulator/examples/changed.cloomc';},
        ()=>api.setProfile('legacy'),
        ()=>api.inspect(6),
        ()=>{api.state.document=JSON.parse(before);},
    ]) {
        api.state.active=true;api.state.profile='ascending';
        api.state.document={rows:[row]};row.authoring.path='simulator/examples/custom_unfinished.cloomc';
        editor.value='race draft';
        let release;pending=new Promise(resolve=>release=resolve);
        const opening=api.source(6);invalidate();
        const held=editor.value, n=confirmations;release();await opening;pending=null;
        assert.equal(editor.value,held);assert.equal(confirmations,n,'stale requests never ask to overwrite');
    }
    api.state.document={rows:[row]};
    delete row.authoring;
    const n=paths.length;
    await api.source(6);
    assert.match(w.document.body.textContent,/no authoring association/);
    assert.equal(paths.length,n,'saved rows without associations never infer a source');
    row.authoring={kind:'assigned-artifact'};
    await api.source(6);
    assert.equal(opens.at(-1)[0].selection.filename,'Old.lump');
    row.selection={};
    await api.source(6);
    assert.match(w.document.body.textContent,/lacks a complete/);
    assert.equal(paths.length,n,'missing exact identity never falls back to catalog');
    dom.window.close();
    console.log('PASS Namespace-owned targets, real replacement consent, exact selections, no catalog and navigation races');
})().catch(error=>{dom.window.close();console.error(error);process.exitCode=1;});
