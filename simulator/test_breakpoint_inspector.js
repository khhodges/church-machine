'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={console};ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname+'/breakpoint-inspector.js','utf8'),ctx);
const BI=ctx.BreakpointInspector;
function machine(config){
  const cr=Array.from({length:16},(_,i)=>({word0:i===3||i===14?((1<<30)|(i===3?5:2))>>>0:0,word1:i===3?100:200,word2:0,word3:0,m:0}));
  return {cr,dr:Array.from({length:16},(_,i)=>i===1?0xFFFFFFFF:i),flags:{N:true,Z:false,C:true,V:false},
    pc:4,bootComplete:true,memory:new Uint32Array(64).fill((2<<27|3<<19|2)>>>0),
    parseGT:w=>({type:w>>>30,index:w&0xFF,gt_seq:0}),decodeInstruction:w=>({opcode:(w>>>27)&31,crDst:(w>>>19)&15,crSrc:(w>>>15)&15,imm:w&0x7FFF}),
    readNSEntry:i=>({word0_location:i===5?100:i===7?300:0}),_clistCountForCR:()=>4,
    _methodNameForSelector:(slot,sel)=>slot===5&&sel===2?'Probe':slot===7&&sel===3?'Deep':null,
    _nextPhysicalAddr:()=>10,simulationConfiguration:config,nsLabels:{5:'EditorLabel'}};
}
ctx._cr14CodeContextHeading=()=>'Code: Run · Abstraction: Cap<T> · Thread: T.1 · Namespace: NewLayout (NS)';
// private: target resolved only from preparedRows
let m=machine({designProfile:'ascending',preparedRows:[{slot:5,seq:0,location:100,name:'Target<x>'}]});
const before=JSON.stringify({cr:m.cr,dr:m.dr,pc:m.pc,flags:m.flags});
let s=BI.open(m,{kind:'instruction',address:10});
assert.equal(JSON.stringify({cr:m.cr,dr:m.dr,pc:m.pc,flags:m.flags}),before,'machine untouched');
assert(Object.isFrozen(s)&&Object.isFrozen(s.cr[3])&&Object.isFrozen(s.dr));
m.dr[2]=99; assert.equal(s.dr[2],2,'snapshot immutable');
assert.equal(s.code,'Run');assert.equal(s.namespace,'NewLayout (NS)');assert.equal(s.source,'private');
assert.equal(s.call.form,'direct');assert.equal(s.call.targetLabel,'CR3');assert.equal(s.call.targetMethod,'Probe');assert.equal(s.call.targetName,'Target<x>');assert.equal(s.call.fromCode,'Run');
const html=BI.render(s);assert(html.includes('Target&lt;x&gt;')&&html.includes('Cap&lt;T&gt;')&&!html.includes('<x>'));
assert.equal(BI.open(m,{kind:'instruction',address:10}),s,'dual hook dedup');
// private with no matching row: honest unresolved, never editor label
BI._resetForTest();
s=BI.open(machine({designProfile:'ascending',preparedRows:[]}),{kind:'instruction',address:10});
assert.equal(s.call.targetName,null);assert(/unresolved/.test(BI.render(s)));
// legacy: own nsLabels
BI._resetForTest();
s=BI.open(machine(undefined),{kind:'boot'});assert.equal(s.source,'legacy');assert.equal(s.call.targetName,'EditorLabel');assert.equal(s.call.targetLabel,'CR3');
// close does not resume
const lm=machine(undefined);lm.running=false;BI.close();assert.equal(lm.running,false);assert.equal(BI.current(),null);
// indexed CR6: target from c-list row, never crDst
BI._resetForTest();
let im=machine({designProfile:'ascending',preparedRows:[{slot:5,seq:0,location:100,name:'WrongCR3'},{slot:7,seq:0,location:300,name:'Indexed'}]});
im.cr[6]={word0:((1<<30)|9)>>>0,word1:40,word2:0,word3:0,m:0};im.memory[41]=((1<<30)|7)>>>0;
im.memory[10]=(2<<27|3<<19|6<<15|(3<<5)|1)>>>0;
const ib=JSON.stringify({cr:im.cr,mem:Array.from(im.memory)});
s=BI.open(im,{kind:'instruction',address:10});
assert.equal(JSON.stringify({cr:im.cr,mem:Array.from(im.memory)}),ib,'indexed: no mutation');
assert.equal(s.call.form,'indexed');assert.equal(s.call.targetLabel,'CR6[1]');assert.equal(s.call.targetName,'Indexed');assert.equal(s.call.targetMethod,'Deep');assert.equal(s.call.selector,3);
BI._resetForTest();im.memory[10]=(2<<27|3<<19|6<<15|(3<<5)|9)>>>0;
s=BI.open(im,{kind:'instruction',address:10});assert.equal(s.call.targetName,null);assert(/outside/.test(s.call.targetReason));
// descriptor mismatch: unresolved
BI._resetForTest();im.readNSEntry=()=>({word0_location:999});im.memory[10]=(2<<27|3<<19|6<<15|(3<<5)|1)>>>0;
s=BI.open(im,{kind:'instruction',address:10});assert.equal(s.call.targetName,null);assert.equal(s.call.targetMethod,null);
// hooks wired in both paths
const run=fs.readFileSync(__dirname+'/app-run.js','utf8'),ds=fs.readFileSync(__dirname+'/design-simulation.js','utf8');
assert(/function _reportBreakpointPause[\s\S]{0,300}BreakpointInspector\.open\(sim/.test(run));
assert(/function _reportBootLoadCR15BreakpointPause[\s\S]{0,500}BreakpointInspector\.open\(sim/.test(run));
assert.equal((ds.match(/BreakpointInspector\.open\(machine/g)||[]).length,2);
const src=fs.readFileSync(__dirname+'/breakpoint-inspector.js','utf8');assert(/removeEventListener\('keydown'/.test(src)&&/returnFocus/.test(src)&&/'Tab'/.test(src));
assert(!/mLoad|\.step\(|\.run\(|fetch\(/.test(fs.readFileSync(__dirname+'/breakpoint-inspector.js','utf8')));
console.log('PASS breakpoint inspector: immutable snapshot, escaping, close-no-resume, private/legacy hooks');
