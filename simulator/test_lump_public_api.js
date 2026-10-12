'use strict';
const assert = require('assert');
const {project, render} = require('./lump-public-api');
const {JSDOM} = require('jsdom');
const fs = require('fs');
const definition = {
    name:'BlackBox', language:'assembly', description:'A public contract',
    capabilities:[{name:'SECRET_DEPENDENCY', rights:['R'], canonical_leaf:'private.device'}],
    returnConvention:{register:'DR1', description:'return value'},
    methods:[
        {name:'Read', index:3, branchOffset:91, offset:92, length:18, source:'internal source',
            inputs:[{name:'access',register:'CR1',kind:'capability',secure_type:'Reader',rights:['R'],canonical_leaf:'private.device'}],
            returns:{name:'result',register:'DR1',type:'word',private_cache:'hidden'}},
        {name:'SecretHelper', index:4, visibility:'private'}
    ]
};
const before = JSON.stringify(definition);
const api = project(definition);
assert.equal(api.methods.length, 1);
assert.equal(api.methods[0].index, 3, 'preserve external selectors, never renumber after hiding private methods');
assert.deepEqual(api.methods[0].inputs[0].rights, ['R'], 'caller-required authority is public');
assert.equal(api.methods[0].returns.register, 'DR1');
for (const forbidden of ['SECRET_DEPENDENCY','private.device','branchOffset','offset','length','private_cache','SecretHelper','assembly'])
    assert(!JSON.stringify(api).includes(forbidden), forbidden);
assert.equal(JSON.stringify(definition), before, 'intrinsic binding metadata must stay intact');
api.methods[0].inputs[0].rights.push('W');
assert.deepEqual(definition.methods[0].inputs[0].rights, ['R'], 'projection cannot mutate authority');
assert.deepEqual(project({name:'WukongCallHome',methods:[],capabilities:definition.capabilities}), {name:'WukongCallHome',methods:[]});
assert.equal(project(null), null);
assert(!render({...definition, name:'<img src=x>'}).includes('<img'));
assert(render(null, false).includes('unavailable'));

// Render both actual tab paths: API hides internals; Internals keeps inspection.
const dom = new JSDOM('<div id="api"></div><div id="internals"></div>', {runScripts:'outside-only'});
const w = dom.window;
w.LumpPublicApi = {project, render};
w._escHtml = text => String(text).replace(/</g, '&lt;');
w._displayLumpCapabilityName = cap => cap ? cap.name : '';
const app = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
w.eval(app.slice(app.indexOf('function _populateLumpApiTab('), app.indexOf('const _lumpSavedSrcLoaded')));
const lump = {api_definition:definition,_apiInspectionComplete:true,_apiInspectionHeader:{cw:75,cc:1,lumpSize:256}};
w._populateLumpApiTab(lump, 'api');
w._populateLumpApiTab(lump, 'internals', true);
assert(!w.document.getElementById('api').textContent.includes('SECRET_DEPENDENCY'));
assert(w.document.getElementById('internals').textContent.includes('SECRET_DEPENDENCY'));
assert.match(app, /internals: `lumpTabInternals_\$\{tk\}`/);
dom.window.close();
console.log('PASS black-box API: public contracts, private isolation, unchanged bindings, both tab paths');
