'use strict';
const assert=require('node:assert/strict');
const {setup,STATE,POOL,SLOT}=require('./test_mint_destroy_v1');
{
    const {s,invoke,cleaner}=setup();
    assert.equal(invoke(cleaner,0,{6:8,7:SLOT}),null);
    const address=s.dr[2];
    assert.equal(address,POOL*4);
    assert(s.memory.slice(POOL,POOL+8).every(x=>x===0));
    s.memory[POOL]=123;
    assert.equal(invoke(cleaner,2,{6:8,7:SLOT,8:address}),null);
    assert.equal(invoke(cleaner,1,{6:8,7:SLOT,8:address}),null);
    assert.equal(s.memory[POOL],123,'release is not synchronous cleaning');
    assert.equal(invoke(cleaner,0,{6:4,7:SLOT+1}),null);
    assert.equal(s.dr[2],address,'another slot can reuse the released block');
    assert(s.memory.slice(POOL,POOL+8).every(x=>x===0),'whole capacity cleared, not only request');
    const state=Array.from(s.memory.slice(STATE,STATE+512));
    assert(invoke(cleaner,1,{6:4,7:SLOT+1,8:address+4}),'wrong base rejected');
    assert.deepEqual(Array.from(s.memory.slice(STATE,STATE+512)),state);
    assert(invoke(cleaner,0,{6:4,7:SLOT+1}),'duplicate live allocation rejected');
    assert.deepEqual(Array.from(s.memory.slice(STATE,STATE+512)),state);
}
{
    const {s,invoke,cleaner}=setup();
    assert.equal(invoke(cleaner,0,{6:16,7:SLOT}),null);
    const before=Array.from(s.memory.slice(STATE,STATE+512));
    assert(invoke(cleaner,0,{6:1,7:SLOT+1}),'pool exhaustion faults');
    assert.deepEqual(Array.from(s.memory.slice(STATE,STATE+512)),before,'exhaustion does not consume state');
    assert.equal(invoke(cleaner,1,{6:16,7:SLOT,8:POOL*4}),null);
    assert(invoke(cleaner,1,{6:16,7:SLOT,8:POOL*4}),'double release rejected');
    assert.equal(invoke(cleaner,0,{6:16,7:SLOT+1}),null,'released block satisfies request at exhausted cursor');
    assert.equal(s.dr[2],POOL*4);
}
console.log('PASS V1 native Cleaner allocation, release, whole-block zeroing, reuse, exhaustion and invalid requests');
