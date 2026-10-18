'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const shell=fs.readFileSync(__dirname+'/app-shell.js','utf8');
const start=shell.indexOf('function openSourceFile(path, options)');
const end=shell.indexOf('// ── Save Source File',start);
assert.ok(start>=0 && end>start);
let epoch=0,confirmations=0,view='',allow=true;
const editor={value:'owned draft',classList:{remove(){}}};
const ctx={
    document:{getElementById:id=>id==='asmEditor'?editor:null,querySelectorAll:()=>[]},
    fetch:async()=>({ok:true,text:async()=>'current Mint'}),
    _captureEditorWriteGuard:()=>{
        const mine=++epoch, text=editor.value;
        return {accepts:()=>epoch===mine && editor.value===text};
    },
    confirmSourceReplacement:async()=>{confirmations++;return allow;},
    closeOpenFileDialog(){},
    switchView:v=>{view=v;},
};
ctx.window=ctx;vm.createContext(ctx);vm.runInContext(shell.slice(start,end),ctx);
(async()=>{
    const guard=ctx._captureEditorWriteGuard();
    await ctx.openSourceFile('simulator/cloomc/mint.cloomc',
        {writeGuard:guard,accepts:()=>guard.accepts(),showEditor:true});
    assert.equal(epoch,1,'must not cancel the parent navigation with a new epoch');
    assert.equal(confirmations,1);assert.equal(editor.value,'current Mint');
    assert.equal(view,'editor');
    editor.value='unsaved marker';allow=false;
    await ctx.openSourceFile('another.cloomc',{showEditor:true});
    assert.equal(editor.value,'unsaved marker','reject preserves exact draft');
    const stale=ctx._captureEditorWriteGuard();ctx._captureEditorWriteGuard();
    allow=true;const n=confirmations;
    await ctx.openSourceFile('late.cloomc',{writeGuard:stale});
    assert.equal(confirmations,n);assert.equal(editor.value,'unsaved marker');
    console.log('PASS source navigation guard handoff, standalone open, cancellation and stale navigation');
})().catch(e=>{console.error(e);process.exitCode=1;});
