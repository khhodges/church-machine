'use strict';
// Bounded isolated acceptance; no publication or physical-board claim.
// Usage: node simulator/test_attack_progress_boundary.js <staged-baseline.bin>
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {create,start} = require('./attack_progress_candidate');
const candidate = create(fs.readFileSync(process.argv[2]));
const sim = start(candidate);
const alice = candidate.records['ide.Alice'];
const driver = candidate.records['ide.AliceDriver'];
const wch = candidate.records['ide.WukongCallHome'];
const address = alice.base+9;
assert.equal(sim.memory[address],41);
assert.equal(sim.memory[driver.base+driver.offsets.expected],41);
assert.equal(sim.memory[wch.base+wch.offsets.valid],0);
// Intended formal budget: >=3 denials, <=6 updates, <=20000 instructions.
// Stop after four denials, before the next update can start.
assert(41+6 <= 0xffffffff);
let output='', busy=0, busyReads=0, commits=[], updateOwners=[];
sim.uartRegs = new Proxy(sim.uartRegs, {
    get(target,key) {
        if(key==='1' && busy>0) {busy--;busyReads++;return 1;}
        return target[key];
    },
    set(target,key,value) {
        if(key==='0') {
            assert.equal(busy,0,'program must finish UART polling before next byte');
            output+=String.fromCharCode(value);
            busy=2;
        }
        target[key]=value;return true;
    },
});
let updating=false, beforeAttack, faultEntries=0, reads=[];
for(let i=0;i<20000 && !sim.halted && sim.faultLog.length<4;i++) {
    const owner=sim._currentThreadSlot, artifact=sim.cr[14].word0&65535;
    const before=sim.memory[address];
    if(artifact===18) updating=true;
    if(updating) updateOwners.push(owner);
    if(updating && artifact===10) updating=false;
    if(artifact===16 && sim.pc===6) reads.push(before);
    if(artifact===17)
        beforeAttack=sim.memory.slice(sim.readNSEntry(11).word0_location,
            sim.readNSEntry(11).word0_location+256);
    const faults=sim.faultLog.length;
    sim.step();
    if(sim.faultLog.length>faults) {
        assert.equal(sim.bootFaultStatus.state,'entered');
        assert.equal(sim._currentThreadSlot,2);
        assert.equal(sim.bootFaultStatus.saveAttempts,1);
        assert.equal(sim.memory[address],before);
        assert.deepEqual(sim.memory.slice(sim.readNSEntry(11).word0_location,
            sim.readNSEntry(11).word0_location+256),beforeAttack);
        faultEntries++;
    }
    if(sim.memory[address]!==before)
        commits.push({owner,before,after:sim.memory[address]});
}
assert.deepEqual(commits,[42,43,44,45].map(after=>({owner:11,before:after-1,after})));
assert.deepEqual(reads,[41,42,42,43,43,44,44,45]);
assert(updateOwners.length>0 && updateOwners.every(owner=>owner===11));
assert.equal(sim.memory[driver.base+driver.offsets.expected],45);
assert.equal(sim.memory[wch.base+wch.offsets.sample],45);
assert.equal(output,'CM:WUKONG Alice=unavailable HF=none\r\n'+
    'CM:WUKONG Alice=42 HF=none\r\nCM:WUKONG Alice=42 HF=none\r\n'+
    [42,43,43,44,44,45].map(n=>`CM:WUKONG Alice=${n} HF=unavailable\r\n`).join(''));
assert.equal(busyReads,output.length*2);
assert.equal(sim.faultLog.length,4);
assert.equal(faultEntries,4);
for(const event of sim.faultLog) {
    assert.equal(event.type,'BOUNDS');
    assert.equal(event.faultCode,8);
    assert.equal(event.threadSlot,12);
    assert.equal(event.pc,1);
    assert.equal(event.faultRawWord,0x070b0020);
}
const fault=sim.faultLog[0];
assert.equal(fault.type,'BOUNDS');
assert.equal(fault.faultCode,8);
assert.equal(fault.threadSlot,12);
assert.equal(fault.pc,1);
assert.equal(fault.faultRawWord,0x070b0020);
assert.match(fault.rawDiagnosticReason,/c-list index 2 is out of bounds/);
assert.equal(sim.bootFaultStatus.state,'entered');
assert.equal(sim.halted,false);
assert.deepEqual(sim.memory.slice(sim.readNSEntry(11).word0_location,
    sim.readNSEntry(11).word0_location+256),beforeAttack);
assert.equal(sim.memory[address],45);
assert.equal(sim.memory[wch.base+wch.offsets.fault],1);
// A different fresh negative fixture: lost Alice data must stop before Stash,
// not "repair" the value from the driver's expected continuity record.
const damaged = {...candidate,image:candidate.image.slice()};
damaged.image[address]=40;
const damagedSim=start(damaged);
for(let i=0;i<5000 && !damagedSim.halted;i++) damagedSim.step();
assert(damagedSim.halted,'continuity mismatch must stop');
assert.equal(damagedSim.memory[address],40);
assert.equal(damagedSim.memory[driver.base+driver.offsets.expected],41);
assert.equal(damagedSim.memory[wch.base+wch.offsets.valid],0);
assert.equal(damagedSim.faultLog.length,0,'explicit diagnostic HALT, not a fabricated denial');
for(const name of ['ide.WukongCallHome','ide.MalloryDriver']) {
    const record=candidate.records[name];
    assert(!record.result.capabilities.some(cap=>cap.name==='ide.Alice'));
}
// The unmodified selected Mallory has SELF/own-RW only.
const mbase=sim.readNSEntry(17).word0_location;
const mh=sim.parseLumpHeader(sim.memory[mbase]);
assert.equal(mh.cc,2);
for(const word of sim.memory.slice(mbase+mh.lumpSize-mh.cc,mbase+mh.lumpSize))
    assert.equal(sim.parseGT(word).index,17);
const evidence = {
    status:'PASS isolated simulation: four real commits and denials; no hardware acceptance',
    imageHash:candidate.imageHash,output,commits,busyReads,
    fault:{type:fault.type,code:fault.faultCode,pc:fault.pc,thread:fault.threadSlot},
    faultEntries,reads,
    candidates:Object.fromEntries(Object.entries(candidate.records).map(([name,r]) =>
        [name,{sourceHash:r.sourceHash,localizedBinaryHashLE:r.binaryHash,base:r.base}])),
};
if(process.argv.includes('--export')) {
    // Review files only, explicitly excluded from publication/deployment.
    const path=require('node:path');
    const directory=path.resolve(__dirname,'../generated-artifacts/attack-progress-review');
    fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,'simulation-candidate-le.bin'),
        Buffer.from(candidate.image.buffer));
    for(const [name,record] of Object.entries(candidate.records))
        fs.writeFileSync(path.join(directory,name+'.cloomc'),record.source);
    fs.writeFileSync(path.join(directory,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
}
console.log(JSON.stringify(evidence,null,2));
