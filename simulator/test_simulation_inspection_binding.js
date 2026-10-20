'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/app-memory.js','utf8');
// Load the helper/navigation declarations, not unrelated UI initialization.
const helpers=source.slice(0,source.indexOf('window._openSimulatorInstructionSource ='))+
    source.slice(source.indexOf('function _findSrcLump('),source.indexOf('function _nsFormatLumpCompiledAt('));
const hash='a'.repeat(64);
const binding={slot:10,token:'ff353b57',filename:'ide.CapabilityTest.1.cc80b80a.lump',binaryHash:hash};
const exact={token:binding.token,filename:binding.filename,binary_hash:hash,
    abstraction:'ide.CapabilityTest',lump_version:4,compiled_at:1};
const old={token:'39700a92',filename:'CapabilityTest.1.b7228a54.lump',
    abstraction:'CapabilityTest',lump_version:44,compiled_at:100};
const calls=[],jumps=[];
const ctx={sim:{simulationConfiguration:{artifactBindings:[binding]},nsLabels:{10:'ide.CapabilityTest'}},
    _lumpsCache:[old,{...exact,filename:'other.lump',lump_version:45,compiled_at:999},exact],
    _nsState:{abstractions:[{slot:10,name:'CapabilityTest',token:old.token}]},
    openLumpInEditor:async(token,options)=>{calls.push({token,options});ctx._editorSavedBinaryReceipt=options.exactSavedArtifact;},
    _jumpToDecompiledInstruction:i=>jumps.push(i)};
ctx.window=ctx;vm.createContext(ctx);vm.runInContext(helpers,ctx);
(async()=>{
    const find=()=>ctx._findSrcLump(10,'CapabilityTest');
    assert.equal(find().lump_version,4);
    assert.equal(ctx._canonicalEditorTokenForSlot(10),binding.token);
    assert(await ctx._openSimulatorInstructionSource(10,15));
    assert.equal(calls[0].options.exactSavedArtifact.filename,binding.filename);
    assert.equal(calls[0].options.exactSavedArtifact.binary_hash,hash);
    assert.deepEqual(jumps,[15]);
    // A shared token or newly saved revision cannot change the bound identity.
    ctx._lumpsCache=[old,{...exact,filename:'new.lump',lump_version:46}];
    assert.equal(find().filename,binding.filename);assert.equal(find().lump_version,undefined);
    ctx._lumpsCache=[old,{...exact,binary_hash:'b'.repeat(64)}];
    assert.equal(find().lump_version,undefined);
    ctx.sim.simulationConfiguration.artifactBindings=[];
    assert.equal(find(),null);assert.equal(ctx._canonicalEditorTokenForSlot(10),null);
    assert.equal(await ctx._openSimulatorInstructionSource(10,15),false);
    ctx.sim.simulationConfiguration.artifactBindings=[binding,binding];
    assert.equal(find(),null);
    delete ctx.sim.simulationConfiguration;
    assert.equal(find().lump_version,44,'legacy browsing remains unchanged');
    console.log('PASS exact simulation inspection: legacy collision, shared tokens, missing/mismatched metadata, exact navigation and missing/ambiguous bindings');
})().catch(e=>{console.error(e);process.exitCode=1;});
