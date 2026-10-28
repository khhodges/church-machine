'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const html = fs.readFileSync(__dirname+'/index.html','utf8');
const dom = new JSDOM(html);
const document = dom.window.document;
const strip = document.getElementById('threadIdentityStrip');
assert(strip.closest('.fixed-toolbar'));
assert.equal(strip.closest('.view'), null);
const rows = Array.from({length:7},(_,i)=>({slot:i+2,name:`Thread.${i+1}`,
    runtimeUnavailable:true,lifecycleStatus:'configured',nia:null}));
const scope = {document,console,sim:{getFormattedCR:()=>({isNull:true})},
    _threadIdentityPage:0,_threadContextModalSlot:null,
    DesignSimulation:{threadDisplay:()=>({current:false,label:'configured · runtime unavailable',rows})},
    _captureDisplayedCRContext:()=>({}),_crPetName:()=>'',_crGtTarget:()=>'',
    switchDashTab:()=>{},updateCRDetail:()=>{},openThreadContextModal:()=>{throw Error('must not execute');}};
scope.window=scope;
vm.createContext(scope);
const run=fs.readFileSync(__dirname+'/app-run.js','utf8');
vm.runInContext(run.slice(run.indexOf('function _threadDisplayStatus('),
    run.indexOf('function _threadModalRow(')),scope);
const cr=fs.readFileSync(__dirname+'/app-cr-display.js','utf8');
vm.runInContext(cr.slice(cr.indexOf('function openCRDetail('),cr.indexOf('function openCRDetailAtPC(')),scope);
scope.updateThreadControl();
assert.equal(strip.querySelectorAll('.thread-identity-card').length,4);
assert.match(strip.textContent,/runtime unavailable/);
const machine=scope.sim;
for(const register of [12,14,6]) {
    scope.openCRDetail(register);
    scope.updateThreadControl();
    assert.equal(scope.sim,machine,'inspection must preserve machine identity');
    assert.equal(strip.hidden,false);
    assert.equal(strip.querySelectorAll('.thread-identity-card').length,4);
}
strip.querySelector('[aria-label="Show next Thread contexts"]').click();
assert.equal(strip.querySelectorAll('.thread-identity-card').length,3);
assert.match(strip.textContent,/Thread.7/);
strip.querySelector('.thread-identity-card').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter'}));
rows.length=0; scope.updateThreadControl();
assert.match(strip.textContent,/No configured Threads available/);
assert.equal(strip.hidden,false);
dom.window.close();
console.log('PASS shared Thread strip: CR12/CR14/CR6 inspection, paging, unavailable and empty states');
