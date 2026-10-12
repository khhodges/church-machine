'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const Builder = require('./lump_builder');

(async () => {
    // SelfTest-sized full source frame. Exercise browser globals, not CommonJS
    // adapters (the endpoint tests alone cannot detect missing served scripts).
    const words = Array(1024).fill(0);
    words[0] = ((31 << 27) | (4 << 23) | (500 << 10) | 1) >>> 0;
    const api = {name:'SelfTest',methods:{Run:{selector:0,returns:'DR1'}}};
    const binary = Builder.embedSelfDefinition(words,api,'; retained source\n'.repeat(1500),2);
    const context = vm.createContext({
        TextDecoder, TextEncoder, Uint8Array, Response,
        CompressionStream, DecompressionStream, console,
    });
    context.window = context;
    const scripts = [...fs.readFileSync('simulator/index.html','utf8')
        .matchAll(/<script src="([^"?]+)(?:\?[^"]*)?"/g)].map(match => match[1]);
    const required = ['lump-api-contract.js','lump-api-codec.js','lump-content-frame.js'];
    for (const script of scripts.filter(name => required.includes(name)))
        vm.runInContext(fs.readFileSync('simulator/'+script,'utf8'),context);
    assert(required.every(name => scripts.includes(name)), 'Missing served API dependency');
    const compile = fs.readFileSync('simulator/app-compile.js','utf8');
    const guard = compile.slice(compile.indexOf('    const _compilerFrame ='),
        compile.indexOf('    const _frameSource ='));
    context.result = {words:binary,compiler_record:{}};
    vm.runInContext('var _frameBuilder = LumpContentFrame;',context);
    const accepted = await vm.runInContext('(async()=>{'+guard+'return _frameApi;})()',context);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(accepted)),api);
    vm.runInContext(`_frameBuilder = {lumpInspectContentFrame: async () =>
        ({contentFrameValid:true,apiDefinition:{methods:{Run:{selector:0}}}})};`,context);
    await assert.rejects(
        vm.runInContext('(async()=>{'+guard+'})()',context),
        /reload the IDE/);
    console.log('PASS browser canonical API compile: served dependencies, Full source, unchanged API, stale-reader diagnosis');
})().catch(error => { console.error(error); process.exitCode = 1; });
