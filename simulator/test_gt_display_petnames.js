'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const mem=fs.readFileSync(__dirname+'/app-memory.js','utf8');
const display=fs.readFileSync(__dirname+'/app-cr-display.js','utf8');
const S=require('./simulator');
const sim=new S();
sim.nsLabels={20:'StaleName'};
sim.simulationConfiguration={preparedRows:[{slot:20,seq:0,name:'ide.ActorManager'}]};
const ctx={sim,_petNameCRMap:{}};
vm.runInNewContext(mem.slice(mem.indexOf('function _gtPetName('),mem.indexOf('function renderBootNSImage(')),ctx);
vm.runInNewContext(display.slice(0,display.indexOf('function _escapeCRDisplayName(')),ctx);
assert.equal(ctx._gtPetName(0x4a000014),'ide.ActorManager');
for(let i=0;i<16;i++)
    assert.equal(ctx._crDisplayName(i,{isNull:false,word0_gt:'4A000014'}),i===5?'ide.ActorManager.Heap':'ide.ActorManager');
assert(ctx._renderGTRow(1,42,0x4a000014).includes('ide.ActorManager'));
// Render the exact Capabilities table section from app-memory.js. This path
// previously bypassed the helper and displayed the legacy SUCC alias.
const start=mem.indexOf("html += '<div class=\"abs-clist-heading\">GOLDEN TOKENS");
const end=mem.indexOf("html += '</tbody></table>';",start);
const table=mem.slice(start,end)+"html += '</tbody></table>';";
const {JSDOM}=require('jsdom');
const document=new JSDOM('').window.document;
Object.assign(ctx,{html:'',threadCapsWords:12,threadCapsStart:244,slotBase:256,addrOf:n=>String(n)});
sim.memory[500]=0x4a000014;
vm.runInNewContext(table,ctx);
const view=document.createElement('div');view.innerHTML=ctx.html;
assert.equal(view.querySelector('.abs-clist-name strong').textContent,'ide.ActorManager');
assert.equal(view.querySelectorAll('.abs-clist-empty-slot').length,11);
ctx.html='';sim.simulationConfiguration.preparedRows[0].name='<Actor>';
vm.runInNewContext(table,ctx);view.innerHTML=ctx.html;
assert.equal(view.querySelector('.abs-clist-name strong').textContent,'<Actor>');
assert.equal(view.querySelector('actor'),null);
sim.simulationConfiguration.preparedRows[0].name='ide.ActorManager';
assert.equal(ctx._gtPetName(0x4a010014),'');
sim.simulationConfiguration.preparedRows=[];
assert.equal(ctx._gtPetName(0x4a000014),'');
delete sim.simulationConfiguration;
assert.equal(ctx._gtPetName(0x4a000014),'StaleName');
assert.equal(ctx._gtPetName(0),'');
ctx._petNameCRMap=Object.fromEntries(Array.from({length:16},(_,i)=>[i,'OldAlias']));
for(let i=0;i<16;i++){
    assert.equal(ctx._crDisplayName(i,{isNull:true,word0_gt:'00000000'}),'');
    assert.equal(ctx._crDisplayName(i,{isNull:false,word0_gt:'00000000'}),'');
    assert.equal(ctx._crDisplayName(i,{isNull:false,word0_gt:'4A00003F'}),'');
}
console.log('PASS all CRs, saved homes, frozen PetNames, stale generation and legacy names');
