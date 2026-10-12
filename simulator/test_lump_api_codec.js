'use strict';
const assert = require('assert');
const codec = require('./lump-api-codec');
const contract = require('./lump-api-contract');
const h = {cw:75,cc:3};
const original = {name:'WukongCallHome',language:'javascript',
    methods:[{name:'Run',index:0,branchOffset:2,inputs:[],returns:{name:'result',register:'DR1'}}],
    capabilities:[{name:'SELF',rights:['E']},
        {name:'LED0',canonical_leaf:'kjhh1.LED0',rights:['R','W']},
        {name:'UART_TX',canonical_leaf:'kjhh1.UART_TX',rights:['R','W']}]};
const snapshot = JSON.stringify(original);
const api = codec.encode(original,h);
assert.equal(contract.serialize(api,h).length,130);
const words = [((75 << 10) | 3) >>> 0,2];
assert.deepStrictEqual(codec.encode(codec.expand(api,words),h),api);
assert.equal(JSON.stringify(original),snapshot);
const threads = {name:'ThreadCaller',methods:[],capabilities:[
    {name:'SELF',rights:['E']},{name:'Thread.2',canonical_leaf:'kjhh1.Thread2',rights:[]}]};
const threadApi = codec.encode(threads,{cw:1,cc:2});
assert.deepStrictEqual(threadApi.imports,{'':{'1':'kjhh1.Thread2'}});
assert.deepStrictEqual(codec.expand(threadApi,[(1<<10)|2,0]).capabilities[1].rights,[]);
const bad = JSON.parse(snapshot);
bad.capabilities[1].grants = ['E'];
assert.throws(()=>codec.encode(bad,h),/Conflicting/);
bad.capabilities[1] = {...original.capabilities[1],binary_hash:'a'.repeat(64)};
assert.throws(()=>codec.encode(bad,h),/locked import/);
bad.capabilities[1] = {...original.capabilities[1],role:'private_data'};
assert.throws(()=>codec.encode(bad,h),/Unsupported runtime/);
const shared = JSON.parse(snapshot);
shared.capabilities[2] = {...shared.capabilities[1],rights:['R']};
const sharedApi = codec.encode(shared,h);
assert.equal(sharedApi.imports.R[2],1);
assert.deepStrictEqual(codec.expand(sharedApi,words).capabilities.map(c=>c.rights),[['E'],['R','W'],['R']]);
const Builder = require('./lump_builder');
const Tokens = require('./capability_tokens');
const base = new Array(128).fill(0);
base[0] = (31 << 27 | 1 << 23 | 75 << 10 | 3) >>> 0;
base[1] = 2;
const binary = Builder.embedSelfDefinition(base, api, '', 0);
const prepared = Tokens.materialize(original.capabilities, binary, 125, {
    canonicalArtifact:true,
    sim:{createGT(){throw Error('Compiler must not mint a GT');}},
});
assert.equal(prepared.ok, true, prepared.errors.join('; '));
assert.deepStrictEqual(binary.slice(125), [0,0,0]);
assert.equal(Tokens.validateClist(binary,125,prepared.resolvedCaps,{}).ok,true);
binary[126] = 0x32000003;
assert.equal(Tokens.validateClist(binary,125,prepared.resolvedCaps,{}).ok,false);
console.log('PASS compact API codec: exact WCH size, lossless supported bindings, explicit zero permissions, no source mutation');
