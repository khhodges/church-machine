'use strict';
// Disposable single-thread V1 evidence only. Always-approve test verifier.
// The fixture selects ascending Namespace geometry to match Mint's declared
// Namespace view. No instruction, CALL, mLoad or fault checks are replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {Sim, fixture} = require('../tests/simulator/cr6_contract_fixture');
const Compiler = require('./cloomc_compiler');
const {assembleLump} = require('./lump_assembler');
Sim.prototype._nsSlotBase = function(slot) { return this.NS_TABLE_BASE + slot * 4; };
const STATE=0x3000, MINTSTATE=0x3300, POOL=0x3500, SLOT=39, HISTORY=16;
function source(name) { return fs.readFileSync(`${__dirname}/cloomc/${name}.cloomc`,'utf8'); }
function setup() {
    const f=fixture(true), s=f.sim;
    const gt=(slot,rights)=>s.createGT(0,slot,Object.fromEntries([...rights].map(p=>[p,1])),1);
    s.withNamespaceWrite('isolated V1 data/service state',()=>{
        s.writeNSEntry(43,MINTSTATE,127,0,0,1,0,0,0);
        s.writeNSEntry(44,POOL,255,0,0,1,0,0,0);
        s.writeNSEntry(45,s.NS_TABLE_BASE,255,0,0,1,0,0,0);
        s.writeNSEntry(46,STATE,511,0,0,1,0,0,0);
    });
    s.memory.set([0,0,16,POOL*4,64],STATE);
    s.memory.set([s.packLumpHeader(1,0,1,0),0,0,7,9,0,HISTORY,SLOT,SLOT+1],MINTSTATE);
    s.memory[MINTSTATE+HISTORY+SLOT]=512;
    s.memory[MINTSTATE+HISTORY+SLOT+1]=512;
    s.memory.fill(0xdeadbeef,POOL,POOL+256);
    function install(slot,name,caps) {
        const c=new Compiler().compile(source(name),[]);
        assert.deepEqual(c.errors,[]);
        const a=assembleLump(c.methods.map(m=>m.code));
        assert.deepEqual(a.errors||[],[]);
        return f.install(slot,a.buf.slice(1),caps);
    }
    const verify=install(27,'pkverify',[]);
    const cleaner=install(28,'mint_cleaner',[gt(46,'RW'),gt(44,'RW')]);
    const mint=install(30,'mint',[gt(43,'RW'),gt(43,'L'),gt(44,'RW'),verify.gt,gt(45,'RW'),cleaner.gt]);
    const callers=new Map();
    function invoke(domain,method,inputs={},caps={},afterStep=null) {
        const key=domain.slot+':'+method;
        if(!callers.has(key)) callers.set(key,f.compile(31+callers.size,
            `LOAD CR1, CR6, #1\nCALL CR1, #${method}\nHALT`,[domain.gt]));
        const caller=callers.get(key);
        f.activate(caller);s.pc=1;s.halted=false;
        Object.assign(s.dr,inputs);
        s.cr[2]={word0:gt(43,'R'),word1:MINTSTATE,word2:127,word3:0,m:0};
        s.cr[3]={...s.cr[2]};
        for(const index of [1,4,7,8]) s.cr[index]={word0:0,word1:0,word2:0,word3:0,m:0};
        Object.assign(s.cr,caps);
        let fault=null,steps=0;
        s.fault=(type,message)=>{fault={type,message,pc:s.pc,dr:Array.from(s.dr),
            codeBase:s.cr[14].word1,trace:s.output.slice(-2200)};s.halted=true;};
        while(!s.halted && steps++<12000) {
            const outputStart=s.output.length;
            s.step();
            // Observation only: stop after a retired instruction; never replace
            // execution, permission checks or a service result.
            if(afterStep && afterStep(s,s.output.slice(outputStart))) {
                s.halted=true;
                return {type:'TEST_CUT',steps};
            }
        }
        assert(steps<12000,'bounded native execution');
        return fault;
    }
    return {s,invoke,mint,cleaner};
}
if (require.main === module) {
    const {s,invoke,mint}=setup();
    assert.equal(invoke(mint,0,{2:8|4,3:3}),null);
    assert.equal(s.dr[1],1);
    const first={...s.cr[1]};
    assert.equal(s.memory[s._nsSlotBase(SLOT)],POOL*4,'CREATE publishes Cleaner physical base');
    assert.equal(first.word0 & 65535,SLOT);
    assert(s.memory.slice(POOL,POOL+8).every(x=>x===0));
    s.memory[POOL]=0x12345678;
    assert.equal(invoke(mint,1,{2:SLOT},{7:first}),null);
    assert.equal(s.dr[1],1);
    assert.equal(s.cr[1].word0,0);
    assert.equal(s.memory[MINTSTATE+HISTORY+SLOT],1,'version advanced at destruction');
    assert(Array.from({length:64},(_,i)=>s.memory[STATE+5+i*4+3]).includes(2),'released, not yet cleaned');
    assert.equal(s.memory[POOL],0x12345678,'Destroy does not clean inline');
    assert.equal(invoke(mint,0,{2:8|4,3:3}),null);
    assert.equal(s.memory[MINTSTATE+HISTORY+SLOT],1025,'no double version increment');
    assert(s.memory.slice(POOL,POOL+8).every(x=>x===0),'service zeroes reused storage');
    const before=Array.from(s.memory);
    assert(invoke(mint,1,{2:SLOT},{7:first}),'stale target cannot destroy replacement');
    assert.deepEqual(Array.from(s.memory.slice(POOL,POOL+256)),before.slice(POOL,POOL+256));
}
if (require.main === module) console.log('PASS isolated V1 CREATE → DESTROY → clean/reuse, retained version and stale-target rejection');
module.exports = {setup,STATE,MINTSTATE,POOL,SLOT,HISTORY};
