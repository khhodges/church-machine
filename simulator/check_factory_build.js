'use strict';
// Execute only the authenticated image returned by normal admission APIs.
const assert = require('node:assert/strict'), fs = require('fs'), crypto = require('crypto');
const Simulator = require('./simulator');
const dir = process.argv[2] || 'generated-artifacts/factory-build';
const raw = fs.readFileSync(dir+'/admitted.bin');
const evidence = JSON.parse(fs.readFileSync(dir+'/admission.json'));
const doc = JSON.parse(fs.readFileSync(dir+'/after.json')).document;
assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),evidence.imageHash);
const words = Uint32Array.from({length:raw.length/4},(_,i)=>raw.readUInt32LE(i*4));
const root = {word0:0x02000001,word1:0,word2:255,word3:0,m:1};
const sim = Simulator.fromAscendingNamespaceImage(words,root);
const boot = sim.readNSEntry(2).word0_location;
const beforeRaw = fs.readFileSync(dir+'/before.bin');
const beforeWords = Uint32Array.from({length:beforeRaw.length/4},(_,i)=>beforeRaw.readUInt32LE(i*4));
const oldBoot = beforeWords[8];
assert.deepEqual(Array.from(words.slice(boot,boot+256)),Array.from(beforeWords.slice(oldBoot,oldBoot+256)));
const handler = doc.faultHandlerSlot;
assert.equal(handler,21);
sim.configureBootFaultEntry({root,
    threadGT:sim.createGT(sim.parseNSWord1(sim.readNSEntry(2).word1_limit).gtSeq,2,{},1),
    handlerGT:sim.createGT(sim.parseNSWord1(sim.readNSEntry(handler).word1_limit).gtSeq,handler,{E:1},1),
    imageIdentity:evidence.imageHash});
sim.beginBoot({clearNonBootThreads:true,freshThreadSlots:doc.rows.filter(r=>
    r.kind==='thread' && Number.isInteger(r.preparedThread?.entryNia)).map(r=>r.slot)});
for(let i=0;i<3;i++) assert(sim._bootStep());
const address = sim.readNSEntry(16).word0_location+9;
assert.equal(sim.memory[address],41);
let output='', updating=false, cycles=0, reads=[], commits=[];
sim.uartRegs = new Proxy(sim.uartRegs,{set(target,key,value){
    if(key==='0') output+=String.fromCharCode(value);target[key]=value;return true;
}});
let steps=0;
for(;steps<20000 && !sim.halted && sim.faultLog.length<4;steps++){
    const owner=sim._currentThreadSlot, artifact=sim.cr[14].word0&65535;
    const before=sim.memory[address], count=sim.faultLog.length;
    if(artifact===18) updating=true;
    if(updating) assert.equal(owner,11,'Alice update interleaved');
    if(updating && artifact===10) updating=false;
    if(artifact===16 && sim.pc===6) reads.push(before);
    const thread2=sim.readNSEntry(11).word0_location;
    const savedThread=sim.memory.slice(thread2,thread2+256);
    sim.step();
    if(sim.memory[address]!==before){
        assert.equal(owner,11);assert.equal(sim.memory[address],before+1);
        commits.push(sim.memory[address]);assert(commits.length<=6);
    }
    if(sim.faultLog.length>count){
        assert.equal(sim.bootFaultStatus.state,'entered');
        assert.equal(sim._currentThreadSlot,2);
        assert.equal(sim.memory[address],before);
        assert.deepEqual(sim.memory.slice(thread2,thread2+256),savedThread);
        cycles++;
    }
}
assert(!sim.halted,JSON.stringify(sim.faultLog));
assert.equal(cycles,4);
assert.deepEqual(commits,[42,43,44,45]);
assert.deepEqual(reads,[41,42,42,43,43,44,44,45]);
assert.equal(output,'CM:WUKONG Alice=unavailable HF=none\r\n'+
    'CM:WUKONG Alice=42 HF=none\r\nCM:WUKONG Alice=42 HF=none\r\n'+
    [42,43,43,44,44,45].map(n=>`CM:WUKONG Alice=${n} HF=unavailable\r\n`).join(''));
for(const fault of sim.faultLog){
    assert.equal(fault.type,'BOUNDS');assert.equal(fault.faultCode,8);
    assert.equal(fault.threadSlot,12);assert.equal(fault.pc,1);
    assert.equal(fault.faultRawWord,0x070b0020);
}
const result={imageHash:evidence.imageHash,steps,cycles,commits,reads,output,
    bootThreadUnchanged:true,otherThreadRetained:true};
fs.writeFileSync(dir+'/execution.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
