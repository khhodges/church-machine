'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const text=fs.readFileSync(__dirname+'/namespace-design-v1.js','utf8');
const section=text.slice(text.indexOf('    async function openObjectEditor('),text.indexOf('    function definitionTarget('));
const calls=[];
const state={active:true,fingerprint:'exact',document:{rows:[{slot:1,kind:'namespace'},{slot:2,kind:'thread'},{slot:3,kind:'mmio',address:0,limit:1,sequence:0},{slot:4,kind:'lump'}]}};
let rejectSelection=false;
const ctx={state,root:{switchView:v=>calls.push(['view',v]),alert:m=>calls.push(['alert',m])},
selectShared:async key=>{calls.push(['select',key]);if(rejectSelection)throw Error('Draft retained');},
source:async slot=>calls.push(['code',slot]),definitionTarget:row=>calls.push(['designer',row.kind,row.slot]),changed:()=>calls.push(['draft'])};
vm.createContext(ctx);vm.runInContext(section,ctx);
(async()=>{
for(const slot of [1,2,3,4]) {calls.length=0; await ctx.openObjectEditor('namespace:copy:test','exact',slot);
assert.deepEqual(calls[0],['select','namespace:copy:test']);
assert.deepEqual(calls.at(-1), slot===1?['view','namespace']:slot===4?['code',4]:['designer',slot===2?'thread':'mmio',slot]);}
calls.length=0;await assert.rejects(ctx.openObjectEditor('namespace:copy:test','stale',4),/Refresh/);assert.equal(calls.length,1);
await assert.rejects(ctx.openObjectEditor('namespace:copy:test','exact',999),/no longer/);
rejectSelection=true;await assert.rejects(ctx.openObjectEditor('namespace:copy:other','exact',4),/Draft retained/);rejectSelection=false;
ctx.setMmio(3,'address','0x4000001c');assert.equal(state.document.rows[2].address,0x4000001c);
ctx.setMmio(3,'sequence','512');assert.equal(state.document.rows[2].sequence,0);
ctx.setMmio(3,'limit','');assert.equal(state.document.rows[2].limit,1);
ctx.setMmio(2,'address','20');assert.equal(state.document.rows[1].address,undefined);
assert(!section.includes('fetch('),'Navigation and draft edits do not save or bind');
console.log('PASS exact Namespace routing for four object kinds, stale/draft guards and MMIO draft validation');
})().catch(e=>{console.error(e);process.exitCode=1;});
