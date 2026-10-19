'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const {spawnSync} = require('child_process');
const Assembler = require('./assembler');
const Compiler = require('./cloomc_compiler');
global.ChurchAssembler = Assembler;
const body = `ide.RoutingProbe {
capabilities { SELF E }
method Run() {
ISUB DR1, DR1, DR1
IADD DR1, #1
RETURN
}
}`;
let expected;
const runSource = fs.readFileSync(__dirname+'/app-run.js','utf8');
const start = runSource.indexOf('function assembleAndLoad(options)');
const end = runSource.indexOf('    const callableAssembly =',start);
assert(start >= 0 && end > start);
for (const keyword of ['abstraction','Abstraction','ABSTRACTION']) {
    const source = '; Abstraction: RoutingProbe\n; Language: Assembly\n'+keyword+' '+body;
    const compiler = new Compiler();
    const compiled = compiler.compileAssembly(source,[]);
    assert.deepEqual(compiled.errors,[]);
    assert.equal(compiled.abstractionName,'ide.RoutingProbe');
    assert.equal(compiled.methods.length,1);
    const words = compiled.methods[0].code;
    assert(Array.isArray(words) && words.length > 0, 'real method instructions required');
    if (!expected) expected = words;
    assert.deepEqual(words,expected,'keyword casing must not change code');
    const context = vm.createContext({
        window:{}, document:{getElementById:()=>({value:source})},
        saveEditorState(){},
        compileAndBuild(options){return {routed:true,source:options.source,options};},
    });
    // Execute the real routing entry before the raw-assembly branch.
    vm.runInContext(runSource.slice(start,end)+'return {routed:false};\n}',context);
    assert.equal(context.assembleAndLoad({candidateOnly:true}).routed,true);
    assert.equal(context.assembleAndLoad({source,candidateOnly:true}).source,source);
    // The signed server worker dispatches assembly independently of the UI.
    const worker = spawnSync(process.execPath,['server/compile_worker.js'],{
        input:JSON.stringify({source,language:'assembly',tier:2}),encoding:'utf8'});
    assert.equal(worker.status,0,worker.stderr);
    const result = JSON.parse(worker.stdout);
    assert.equal(result.ok,true,JSON.stringify(result.errors || result));
}
console.log('PASS structured Assembly routing: browser and server accept declaration casing without changing source or code');
