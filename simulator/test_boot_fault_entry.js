'use strict';
const assert = require('node:assert/strict');
const Simulator = require('./simulator');
const Assembler = require('./assembler');
const layout = require('./thread_design').layout(256, 32);
function fixture() {
    const memory = new Uint32Array(16384);
    for (const base of [0,8192]) {
        memory[base] = ((31<<27)|(64<<10)|(1<<8))>>>0;
        memory[base+1] = base;
        memory[base+2] = 3;
    }
    const root = base => ({word0:0x02000001,word1:base,word2:255,word3:0,m:0});
    const sim = Simulator.fromNamespaceImage(memory, root(8192));
    const handlerGT = sim.createGT(0,4,{E:1},1);
    function desc(ns, slot, base, limit) {
        const w1=sim.packNSWord1(limit,0,0,0);
        sim.memory.set([base,w1,sim._integrity32(base,w1),0],ns+slot*4);
    }
    for (const ns of [0,8192]) {
        desc(ns,1,ns,255);
        const assembler = new Assembler();
        const words = assembler.assemble(ns ? 'DREAD DR1, CR3, #0\nHALT' : 'NOP\nHALT').words;
        assert.equal(assembler.errors.length,0);
        sim.memory[ns+512] = sim.packLumpHeader(0,words.length,1,0);
        sim.memory.set(words,ns+513);
        sim.memory[ns+575] = handlerGT;
        desc(ns,4,ns+512,words.length);
        sim.memory[ns+256] = sim.packLumpHeader(2,32,12,2);
        sim.memory[ns+256+layout.capsStart] = handlerGT;
        sim._formatThreadRootSentinel(ns+256,layout,handlerGT,{image:true});
        desc(ns,2,ns+256,255);
    }
    sim.configureBootFaultEntry({root:root(0),threadGT:0x02000002,
        imageIdentity:'isolated-fixture-exact-words'});
    // Boot has yielded at a nonzero NIA, retaining an ordinary suspended frame.
    sim.flags={Z:true,N:false,C:true,V:false};
    sim.memory[256+layout.stackEnd]=sim._packFrameWord(1,1,layout.stackEnd);
    sim.flags={Z:false,N:false,C:false,V:false};
    // A different saved CR0 must not select the continuation executable.
    sim.memory[256+layout.capsStart]=0;
    sim.memory[256+7]=0x12345678; // DR6 is not part of the fault ABI.
    assert(sim.startEntryThread(), JSON.stringify(sim.faultLog));
    return sim;
}
{
    const sim=fixture();
    const cr13={word0:123,word1:456,word2:789,m:1};sim.cr[13]={...cr13};
    const foreign={...sim.cr[12]}, root={...sim.cr[15]};
    const result=sim.step();
    assert.equal(sim.bootFaultStatus.state,'entered',JSON.stringify(sim.bootFaultStatus));
    assert(result.faultEntry);
    assert.equal(sim.cr[15].word1,0);
    assert.equal(sim.cr[12].word1,256);
    assert.deepEqual(sim.cr[1],foreign);
    assert.deepEqual(sim.cr[2],root);
    assert.deepEqual(sim.cr[13],cr13);
    assert.equal(sim.dr[3],1);
    assert.equal(sim.dr[2],(8192+513)*4);
    assert.equal(sim.bootFaultStatus.saveAttempts,1);
    assert.equal(sim.bootFaultStatus.writes[0],256+layout.capsStart+1);
    assert.equal(sim.pc,1);
    assert.equal(result.pc,1);
    assert.equal(sim.dr[6],0x12345678);
    assert.equal(sim.cr[0].word0,0,'CR0 is restored, not replaced by an E handler');
    assert(sim.flags.Z && sim.flags.C,'retained frame flags survive');
    assert.equal(sim.sto,layout.stackEnd,'fault entry pops the retained frame');
    assert.equal(sim.halted,false);
    assert.equal(sim._unpackFrameWord(sim.memory[256+layout.stackEnd]).returnPC,1);
    sim.step();
    assert(sim.halted,'retained NIA executes HALT, not a fresh entry');
}
{
    const sim=fixture();sim.sto=0;
    sim.step();
    assert.equal(sim.bootFaultStatus.state,'entered',JSON.stringify(sim.bootFaultStatus));
    assert.equal(sim.dr[3],2);
    assert.equal(sim.dr[5],Simulator.FAULT_CODES.BOUNDS);
}
{
    const sim=fixture();
    const write=sim._writeRuntimeWord;
    sim._writeRuntimeWord=function(a,v){if(a===256+layout.capsStart+1)return;return write.call(this,a,v);};
    sim.step();
    assert.equal(sim.bootFaultStatus.state,'catastrophic');
    assert.equal(sim.bootFaultStatus.saveAttempts,0);
    assert(sim.halted);
    const count=sim.bootFaultStatus.writes.length;
    sim.step();
    assert.equal(sim.bootFaultStatus.writes.length,count,'no retry');
}
{
    const sim=fixture();sim.memory[256]^=1;sim.step();
    assert.equal(sim.bootFaultStatus.state,'catastrophic');
    assert.equal(sim.bootFaultStatus.writes.length,0);
}
{
    const sim=fixture();
    // Boot is already executing: never overwrite its own source context.
    sim.cr[12].word1=256;sim.step();
    assert.equal(sim.bootFaultStatus.state,'catastrophic');
    assert.equal(sim.bootFaultStatus.writes.length,0);
}
{
    const sim=fixture(), write=sim._writeRuntimeWord;
    sim._writeRuntimeWord=function(a,v) {
        if(a===256+4 && v===1) throw Error('status store failed');
        return write.call(this,a,v);
    };
    sim.step();
    assert.equal(sim.bootFaultStatus.state,'catastrophic');
    assert.equal(sim.bootFaultStatus.saveAttempts,1);
}
{
    const sim=fixture(), write=sim._writeRuntimeWord;
    sim._writeRuntimeWord=function(a,v) {
        if(a===8192+258) throw Object.assign(Error('partial save'),{fault:'BOUNDS'});
        return write.call(this,a,v);
    };
    sim.step();
    assert.equal(sim.bootFaultStatus.state,'entered');
    assert.equal(sim.dr[3],2);
    assert.equal(sim.dr[5],8);
}
{
    const sim=fixture();
    sim.memory[256+layout.stackEnd]=sim._packFrameWord(0x7fff,1,layout.stackEnd);
    sim.step();
    assert.equal(sim.bootFaultStatus.state,'catastrophic','no fresh-start fallback');
}
{
    const sim=fixture();
    sim.memory[256+layout.stackEnd]=sim._packFrameWord(9,1,layout.stackEnd);
    sim.step();
    assert.equal(sim.bootFaultStatus.state,'catastrophic','invalid retained NIA cannot restart code');
}
console.log('PASS Boot fault entry: retained continuation, foreign roots, stash ordering, save status, CR13, failed stash and immutable configuration');
