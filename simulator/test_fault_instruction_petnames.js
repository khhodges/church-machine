'use strict';
const assert=require('node:assert/strict');
const Sim=require('./simulator.js');
const s=new Sim();
s.cr[14].word0=s.createGT(0,10,{R:1,X:1},1);
s.cr[6].word1=4000;
s._clistCountForCR=()=>2;
s.cr[11].word0=s.createGT(0,4,{R:1},1);
s.memory[4001]=s.createGT(0,4,{R:1,W:1},1);
s.simulationConfiguration={artifactBindings:[{slot:10,portableBinding:{
    owner:'ide.CapabilityTest',dependencies:[{name:'ide.ButtonInput',relocation_row:1}]
}}]};
s._activeFaultRoute={step:s.stepCount,transfer:false,callerName:'NS[10]',callerMethod:'Run'};
s.fault('PERMISSION','DWRITE: CR11: lacks W permission');
const f=s.faultLog.at(-1);
assert.equal(f.message,'DWRITE: CR11: lacks W permission');
assert.equal(f.pet_names.CR11,'ide.ButtonInput');
const ui=require('node:fs').readFileSync(__dirname+'/app-run.js','utf8');
const formatter=ui.slice(ui.indexOf('    function _transformFaultMsg(msg) {'),
    ui.indexOf('    // ── Click-to-edit:',ui.indexOf('    function _transformFaultMsg(msg) {')));
const format=new Function('_petCR','_petDR','_faultCListSlot','_faultCListPetName',
    formatter+';return _transformFaultMsg;')({11:f.pet_names.CR11},{},null,null);
assert.match(format(f.message),/^DWRITE: ide\.ButtonInput\s+\(CR11\): lacks W permission$/);
assert(!f.message.includes('unknown'));
s.memory[4001]=0;s.nsLabels[4]='Changed.Name';
assert.equal(f.pet_names.CR11,'ide.ButtonInput','fault names are captured, not recomputed');
assert.equal(s._faultDeclaredPetNames()[11],undefined,'NULL row supplies no identity');
s.memory[4001]=s.createGT(1,4,{R:1},1);
assert.equal(s._faultDeclaredPetNames()[11],undefined,'stale identity supplies no pet name');
console.log('PASS instruction fault description: actual operand pet name, attenuation, frozen evidence, null/stale rejection');
