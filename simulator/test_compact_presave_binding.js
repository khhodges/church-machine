'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const Tokens = require('./capability_tokens');
const Builder = require('./lump_builder');
const Codec = require('./lump-api-codec');
const Frame = require('./lump-content-frame');

// Execute both real save gates, not only the audit display. The local registry
// deliberately has no dependencies; publication must not try to mint GTs.
const caps = [{name:'SELF',rights:['E']},
    {name:'ide.SelfTest',rights:['E']},
    {name:'ide.LED_DEV',rights:['R','W']},
    {name:'ide.Thread.2',rights:[]},
    {name:'ide.Thread.3',rights:[]}];
const raw = Array(64).fill(0);
raw[0] = ((31 << 27) | (1 << 10) | caps.length) >>> 0;
const api = Codec.encode({name:'ide.SaveProbe',methods:[],capabilities:caps},
    {cw:1,cc:caps.length});
const words = Builder.embedSelfDefinition(raw, api, '; save probe\n', 2);
const before = words.slice();
const source = fs.readFileSync(__dirname+'/app-run.js','utf8');
const preStart = source.indexOf('        var _preSaveHdr =');
const preEnd = source.indexOf('        if (!_preSaveValidation.ok)',preStart);
const finalStart = source.indexOf('function _validateFinalLumpSaveBinary(');
const finalEnd = source.indexOf('\nasync function confirmSaveToNamespace',finalStart);
const context = vm.createContext({
    window:{}, CapabilityTokens:Tokens, _caps:caps, _svBinary:words, _lumpsCache:[],
    lumpDecodeContentFrameApi:Frame.lumpDecodeContentFrameApi,
    sim:{abstractionRegistry:{abstractions:{}},parseLumpHeader(word){
        return {valid:true, cc:word&255,lumpSize:2**(((word>>>23)&15)+6)};
    }},
});
vm.runInContext(source.slice(finalStart,finalEnd),context);
function preflight(binary=words, declarations=caps) {
    context._svBinary = binary;
    context._caps = declarations;
    vm.runInContext(source.slice(preStart,preEnd),context);
    return context._preSaveValidation;
}
assert.equal(preflight().ok,true,JSON.stringify(context._preSaveValidation));
assert.equal(context._validateFinalLumpSaveBinary(words,caps,{}),true);
assert.deepEqual(words,before);
assert.deepEqual(context.sim.abstractionRegistry.abstractions,{});

for (const badCaps of [
    caps.map((cap,i)=>i===1 ? {...cap,name:'ide.Other'} : cap),
    caps.map((cap,i)=>i===1 ? {...cap,rights:['L','E']} : cap),
    caps.slice(0,-1),
]) {
    assert.equal(preflight(words,badCaps).ok,false);
    assert.throws(()=>context._validateFinalLumpSaveBinary(words,badCaps,{}));
}
const bound = words.slice();
bound[words.length-caps.length+1] = 0x46000006;
assert.equal(preflight(bound).ok,false,'never admit local GTs in canonical artifacts');
assert.throws(()=>context._validateFinalLumpSaveBinary(bound,caps,{}));
const boundBefore = bound.slice();
preflight(bound);
assert.deepEqual(bound,boundBefore,'validation must not erase tampered GTs');
const resolved = Tokens.resolveCapabilities(caps,{});
assert.equal(Tokens.validateClist(words,words.length-caps.length,resolved,{}).ok,false,
    'destination validation remains strict without publication context');
const Guard = require('./symbolic-lump-guard');
const symbolicApi = {...api, symbolic_binding:{
    schema:'church.symbolic-lump-binding/v1', owner:'ide.SaveProbe', calls:[],
    dependencies:caps.map((cap,row)=>({...cap,relocation_row:row,symbolic_self:row===0})),
}};
const symbolic = Builder.embedSelfDefinition(words,symbolicApi,'; save probe\n',2);
assert.equal(Guard.validate(symbolic,{capabilities:caps}).symbolic,true);
const marker = symbolic.slice();
marker[marker.length-caps.length] = 0xFEED5E1F;
assert.equal(Guard.validate(marker,{capabilities:caps}).symbolic,true,
    'retain inert original compiler markers');
for (const row of [0,1]) {
    const injected = symbolic.slice();
    injected[injected.length-caps.length+row] = 0x46000006;
    assert.throws(()=>Guard.validate(injected,{capabilities:caps}));
}
console.log('PASS compact pre-save and final gates: unresolved dependencies and permissionless Threads, identity/rights/count/GT tamper rejection');
