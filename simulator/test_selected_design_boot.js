'use strict';
const assert=require('node:assert/strict');
const Simulator=require('./simulator');
function fixture() {
    const memory=new Uint32Array(16384);
    memory[0]=((31<<27)|(64<<10)|(1<<8))>>>0;
    memory[2]=2;
    memory.set([0,255,0,0],4);
    memory.set([256,255,0,0],8);
    memory.set([512,63,0,0],12);
    const sim=Simulator.fromAscendingNamespaceImage(memory,
        {word0:0x02000001,word1:0,word2:255,word3:0,m:1});
    for(const slot of [1,2,3]) sim.memory[slot*4+2]=
        sim._integrity32(sim.memory[slot*4],sim.memory[slot*4+1]);
    sim.memory[256]=sim.packLumpHeader(2,32,12,2);
    sim.memory[512]=sim.packLumpHeader(0,2,1,0);
    sim.memory[575]=0x4a000003;
    const layout=sim._threadLayoutAtBase(256);
    sim.memory[256+layout.capsStart]=0x4a000003;
    sim._formatThreadRootSentinel(256,layout,0x4a000003,{image:true});
    return sim;
}
const sim=fixture(), original=sim.memory.slice();
sim.beginBoot();
assert.equal(sim.bootComplete,false);
assert(sim.cr.every(c=>c.word0===0));
assert.deepEqual(sim.memory,original,'reset does not rewrite the admitted image');
for(let i=0;i<3;i++){
    assert.equal(sim._bootStep(),true,JSON.stringify(sim.faultLog));
    assert.equal(sim.bootProgress[i].status,'completed');
    assert.equal(sim.bootComplete,i===2);
    if(i===0) {
        assert.equal(sim.cr[15].word0,0x02000001);
        assert.equal(sim.cr[12].word0,0);
    }
    if(i===1) {
        assert.equal(sim.cr[12].word0,0x02000002);
        assert.equal(sim.cr[0].word0,0x4a000003);
        assert.equal(sim.cr[14].word0,0,'CHANGE does not silently enter the program');
        const homes=256+sim._threadLayoutAtBase(256).capsStart;
        assert.deepEqual(sim.memory.slice(homes,homes+12),original.slice(homes,homes+12),
            'LOAD and CHANGE preserve the prepared capability homes');
    }
}
assert.equal(sim.cr[14].word1,512);
assert(sim.callStack.at(-1).sentinel,'CALL establishes the real root frame');
assert.equal(sim.stepCount,0,'no program instruction ran during boot');
assert(sim.step());
assert.equal(sim.stepCount,1);
for(const bad of [0,0x02000003]){
    const broken=fixture(), layout=broken._threadLayoutAtBase(256);
    broken.memory[256+layout.capsStart]=bad;
    broken.beginBoot();
    assert(broken._bootStep());
    assert(broken._bootStep());
    assert.equal(broken._bootStep(),false);
    assert(broken.halted);
    assert.equal(broken.bootProgress[2].status,'failed');
    assert.equal(broken.cr[0].word0,bad,'boot never repairs an invalid prepared CR0');
}
console.log('PASS selected image real LOAD/CHANGE/CALL boot, prepared authority, progress and failed CALL');
