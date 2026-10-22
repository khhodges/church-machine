'use strict';
// Native entry guards only: no CREATE, release, authentication or lifecycle
// acceptance is inferred from these pre-mutation rejection checks.
const assert = require('node:assert/strict');
const {setup, STATE, MINTSTATE, POOL, SLOT} = require('./test_mint_destroy_v1');
const nil = () => ({word0:0,word1:0,word2:0,word3:0,m:0});
const cases = [
    ['missing credential', {2:nil()}, SLOT, 'TPERM CR2, NULL'],
    ['missing proof', {3:nil()}, SLOT, 'TPERM CR3'],
    ['missing target', {7:nil()}, SLOT, 'TPERM CR7, NULL'],
    ['non-NULL CR4', {4:'cap'}, SLOT, 'TPERM CR4, NULL'],
    ['non-NULL CR8', {8:'cap'}, SLOT, 'TPERM CR8, NULL'],
    ['protected slot zero', {}, 0, ''],
    ['protected slot one', {}, 1, ''],
    ['out-of-range slot', {}, 65536, ''],
];
for (const [name, overrides, slot, trace] of cases) {
    const {s,invoke,mint}=setup();
    // Valid readable fixture data, not a destruction authentication proof.
    const cap = {word0:s.createGT(0,43,{R:1},1),
        word1:MINTSTATE,word2:127,word3:0,m:0};
    const caps={7:{...cap}};
    for(const [reg,value] of Object.entries(overrides)) {
        caps[reg]=value==='cap'?{...cap}:value;
    }
    // invoke lazily installs its caller LUMP. Provision it before taking the
    // no-mutation snapshot. The missing-target probe also primes the legacy
    // simulator's first-read flag on the proof descriptor, not object release.
    assert(invoke(mint,1,{2:SLOT},{7:nil()}));
    const regions = [
        [STATE,512], [MINTSTATE,128], [POOL,256],
        [s.NS_TABLE_BASE,s.memory.length-s.NS_TABLE_BASE],
    ];
    const before=regions.map(([base,length])=>Array.from(s.memory.slice(base,base+length)));
    const fault=invoke(mint,1,{2:slot},caps);
    assert(fault,`${name}: must fault`);
    assert.equal(s.dr[1],0,`${name}: no completion`);
    assert.equal(s.cr[1].word0,0,`${name}: no result authority`);
    if(trace) assert(fault.trace.includes(trace),`${name}: expected input guard reached`);
    regions.forEach(([base,length],i)=>assert.deepEqual(
        Array.from(s.memory.slice(base,base+length)),before[i],
        `${name}: no Namespace/history/queue/release/pool mutation`));
}
console.log('PASS V1 DESTROY eight native pre-mutation entry rejections (not lifecycle acceptance)');
