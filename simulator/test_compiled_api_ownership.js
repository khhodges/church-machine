'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const Compiler = require('./cloomc_compiler');
const frames = require('./lump-content-frame');
const {embedSelfDefinition} = require('./lump_builder');
const app = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
const context = vm.createContext({
    window:{},
    bootEntrySlot:6,
    _lumpManifests:{6:{_methods:[{name:'WrongBootMethod'}]}},
    sim:{_lastCompiledLanguage:'wrong-dialect'},
});
vm.runInContext(app.slice(app.indexOf('function _formatLumpApiDefinition('),
    app.indexOf('// Format the C-list from the immutable embedded API')), context);
vm.runInContext(fs.readFileSync(__dirname + '/lump-registry.js', 'utf8'), context);
const format = context._formatLumpApiDefinition;
const source = 'abstraction MethodFixture {\nmethod Run() {\nreturn(1);\n}\n}\n';
const compiled = new Compiler().compile(source, []);
assert.deepStrictEqual(compiled.errors, []);
assert.equal(compiled.methods[0].name, 'Run');
const api = format('MethodFixture', compiled.capabilities, compiled);
assert.equal(api.methods[0].name, 'Run');
assert.equal(api.methods[0].index, 0);
assert.equal(api.language, compiled.language);
assert(!JSON.stringify(api).includes('WrongBootMethod'));
const privateFirst = format('Fixture', [], {language:'assembly', methods:[
    {name:'helper',visibility:'private'}, {name:'Run',params:['count','reader: capability Reader RW']}
]});
assert.equal(privateFirst.methods[0].index, 1, 'private filtering must not renumber selectors');
assert.equal(privateFirst.methods[0].inputs[0].register, 'DR1');
assert.equal(privateFirst.methods[0].inputs[1].register, 'CR1');
assert.deepStrictEqual(Array.from(privateFirst.methods[0].inputs[1].rights), ['R','W']);
assert.equal(format('RawAssembly', [], {methods:[]}).methods.length, 0);
assert.throws(() => format('Unknown', [], {}), /Compile the current source again/);
context.window.LumpRegistry.registerMemory('abcd1234','MethodFixture',[1],[],{
    sourceText:source,language:compiled.language,apiDefinition:api
});
const memory = context.window.LumpRegistry.resolve('abcd1234').sources.memory;
api.methods[0].name = 'MUTATED';
context._lumpManifests[6]._methods[0].name = 'ANOTHER_WRONG_METHOD';
const saved = format('MethodFixture', compiled.capabilities, memory);
assert.equal(saved.methods[0].name, 'Run', 'registry must own a deep copy of the exact compiled API');
saved.methods[0].name = 'MUTATED_AGAIN';
assert.equal(memory.apiDefinition.methods[0].name, 'Run');
(async () => {
    const code = compiled.methods.flatMap(m => m.code);
    const base = new Array(64).fill(0);
    base[0] = ((31 << 27) | (code.length << 10)) >>> 0;
    base.splice(1, code.length, ...code);
    for (const tier of [0,1,2]) {
        const words = embedSelfDefinition(base, format('MethodFixture', compiled.capabilities, memory),
            source, tier, compiled.language);
        const inspected = await frames.lumpInspectContentFrame(words);
        assert(inspected.contentFrameValid);
        assert.equal(inspected.apiDefinition.methods[0].name, 'Run');
        assert.equal(inspected.apiDefinition.methods[0].index, 0);
    }
    console.log('PASS compiled API ownership: Run, selectors, parameter rights, immutable registry, three forms');
})().catch(error => { console.error(error); process.exitCode = 1; });
