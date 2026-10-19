'use strict';

// Draft-source checks, not acceptance of a functioning Mint implementation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.ChurchAssembler = require('./assembler');
global.METHOD_REGISTER_CONVENTIONS = {};
global.BOOT_UPLOADS = [];
const Compiler = require('./cloomc_compiler');
const source = fs.readFileSync(path.join(__dirname,
    'cloomc/mint.cloomc'), 'utf8');
assert.match(source, /CURRENT EDITABLE SOURCE/);
assert.equal(fs.existsSync(path.join(__dirname,
    'cloomc/drafts/Mint-Phase1-API-DRAFT.cloomc')), false,
    'There must not be a competing editable Mint draft');
const methods = [...source.matchAll(/^method (\w+) \{([\s\S]*?)^\}/gm)];
assert.deepEqual(methods.map(m => m[1]),
    ['CREATE', 'DESTROY', 'MakeOutform', 'MakeInform']);

const compiled = new Compiler().compile(source, []);
assert.ok(compiled.errors.length > 0, 'Unfinished draft must not compile as runnable Mint');
assert.ok(compiled.errors.every(e => /^Undefined label: TODO_/.test(e.message)),
    JSON.stringify(compiled.errors.filter(e => !/^Undefined label: TODO_/.test(e.message))));
assert.equal(compiled.methods.length, 0, 'No partly valid method may escape as a successful draft');
assert.equal(compiled.language, 'assembly');

for (const [, name, body] of methods) {
    assert.match(body, new RegExp(`^\\s*${name}_inputs:`),
        'Every table entry must reach its own method input checks first');
    assert.match(body, /TPERM CR1, CLEAR/);
    assert.match(body, /IADD DR1, DR0, #0/);
    assert.doesNotMatch(body, /IADD DR1, DR0, #1\b/, 'Wrapper must not manufacture success');
    for (const label of body.match(/TODO_\w+/g) || []) {
        assert.ok(label.startsWith(`TODO_${name}_`), `${label} must identify API method ${name}`);
    }
    assert.match(body, new RegExp(`TPERM CR2, NULL\\s+BRANCHEQ TODO_${name}_INPUT_CREDENTIAL_NULL`));
    assert.match(body, new RegExp(`TPERM CR3, R\\s+BRANCHNE TODO_${name}_INPUT_PROOF_READ`));
    assert.match(body, new RegExp(`DREAD DR${name === 'CREATE' ? 4 : 2}, CR3, #3`));
    assert.match(body, new RegExp(`MCMP DR1, #1\\s+BRANCHNE TODO_${name}_RESULT_COMPLETION`));
    const result = body.slice(body.indexOf(`${name === 'CREATE' ? 'create' :
        name === 'DESTROY' ? 'destroy' : name === 'MakeOutform' ? 'outform' : 'inform'}_result:`));
    assert.match(result, name === 'DESTROY'
        ? /TPERM CR1, NULL\s+BRANCHNE TODO_DESTROY_RESULT_NOT_NULL/
        : new RegExp(`TPERM CR1, NULL\\s+BRANCHEQ TODO_${name}_RESULT_NULL`));
    assert.match(body, new RegExp(`RETURNAL #${name === 'DESTROY' ? 0 : 2}`));
    assert.doesNotMatch(body, /^\s*MINT\s/m, 'No private profile instructions');
}
const create = methods[0][2], destroy = methods[1][2];
assert.doesNotMatch(create, /12-word|#257|CR4, #11|CR4, #10/);
assert.match(create, /BFEXT DR4, DR2, #0, #3/);
assert.match(create, /BRANCH TODO_CREATE_PKVERIFY_AND_ALLOWANCE/);
assert.match(create, /BRANCH TODO_CREATE_SOURCE_EXTENT/);
assert.match(create, /BRANCH TODO_CREATE_ALLOCATE_PRIVATE_DATA/);
assert.match(create, /BRANCH TODO_CREATE_COMMIT_ACCOUNT_AND_ISSUE/);
assert.match(create, /BRANCH TODO_CREATE_RESULT_TYPE/);
assert.ok(destroy.indexOf('TODO_DESTROY_REJECT_RESIDENT_AND_OUTFORM') <
    destroy.indexOf('destroy_body:'));

// Walk the actual draft's scalar/copy instructions, NOT the unresolved services.
// Native syntax is independently checked above. This is not full Mint acceptance.
const guards=create.slice(create.indexOf('create_data_scalar_checks:'),
    create.indexOf('create_finish:')).split('\n')
    .map(s=>s.split(';')[0].trim()).filter(Boolean);
const labels=new Map(guards.map((s,i)=>[s.endsWith(':')?s.slice(0,-1):'',i]));
function walk(start, dr, source=[], destination=[]) {
    let cmp=0;
    dr.DR0=0;
    for(let pc=labels.get(start),steps=0;pc<guards.length && steps++<10000;pc++) {
        const line=guards[pc];
        if(line.endsWith(':')) continue;
        const [op,...args]=line.replace(/,/g,'').split(/\s+/);
        const value=s=>s.startsWith('#')?Number(s.slice(1)):dr[s];
        if(op==='IADD') dr[args[0]]=(value(args[1])+value(args[2]))>>>0;
        else if(op==='BFEXT') dr[args[0]]=(value(args[1])>>>value(args[2])) & ((2**value(args[3]))-1);
        else if(op==='BFINS') {
            const mask=((2**value(args[3]))-1)<<value(args[2]);
            dr[args[0]]=((value(args[0]) & ~mask) | ((value(args[1])<<value(args[2])) & mask))>>>0;
        }
        else if(op==='DREAD') {
            assert.equal(args[1],'CR4');
            const i=value(args[2])+value(args[3]);
            assert.ok(i<source.length,'source read must be bounded');
            dr[args[0]]=source[i]>>>0;
        }
        else if(op==='DWRITE') {
            assert.equal(args[1],'CR8');
            const i=value(args[2])+value(args[3]);
            assert.ok(i<destination.length,'destination write must be bounded');
            destination[i]=value(args[0])>>>0;
        }
        else if(op==='MCMP') cmp=value(args[0])-value(args[1]);
        else if(op==='SHR') dr[args[0]]=value(args[1])>>>value(args[2]);
        else if(op.startsWith('BRANCH')) {
            const take={BRANCH:true,BRANCHEQ:cmp===0,BRANCHNE:cmp!==0,BRANCHHI:cmp>0}[op];
            assert.notEqual(take,undefined,op);
            if(take) {
                if(args[0].startsWith('TODO_')) return args[0];
                assert.ok(labels.has(args[0]),args[0]);pc=labels.get(args[0]);
            }
        } else assert.fail('Unsupported guard instruction '+line);
    }
    assert.fail('Draft fragment failed to reach its explicit service boundary');
}
function requestGate(packed, permission=3) {
    const dr={DR2:packed>>>0,DR3:permission};
    const gate=walk('create_data_scalar_checks',dr);
    return {gate,dr};
}
for(let power=3;power<=31;power++) {
    const size=2**power;
    const {gate,dr}=requestGate(size+4);
    assert.equal(gate,'TODO_CREATE_PKVERIFY_AND_ALLOWANCE');
    assert.equal(dr.DR6,size,'accounting gets decoded allocation, not packed DR2');
    assert.equal(dr.DR2,size+4);
    assert.equal(dr.DR3,3);
}
for(const caseId of [0,1,2,3,5,6,7]) {
    assert.equal(requestGate(64+caseId).gate,'TODO_CREATE_INPUT_CASE_NOT_DATA');
}
for(const permission of [0,1,2,4,5,6,7,0xffffffff]) {
    assert.equal(requestGate(68,permission).gate,'TODO_CREATE_INPUT_PERMISSIONS_NOT_RW');
}
assert.equal(requestGate(4).gate,'TODO_CREATE_INPUT_ALLOCATION_ZERO');
for(const size of [24,40,56,72,0xfffffff8]) {
    assert.equal(requestGate(size+4).gate,'TODO_CREATE_INPUT_SIZE_NOT_POWER_TWO');
}
assert.equal(walk('create_data_extent_checked',{DR11:65,DR6:64}),
    'TODO_CREATE_INPUT_SOURCE_EXCEEDS_ALLOCATION');
assert.equal(walk('create_data_extent_checked',{DR11:64,DR6:64}),
    'TODO_CREATE_ALLOCATE_PRIVATE_DATA');
// Enter isolated copy fragment with TEST-owned storage, not claimed allocation.
for(const count of [0,1,3,63,64]) {
    const input=Array.from({length:count},(_,i)=>(0x80000000+i)>>>0);
    const before=input.slice(), output=Array(64).fill(0xdeadbeef);
    assert.equal(walk('create_data_copy_begin',{DR6:64,DR11:count},input,output),
        'TODO_CREATE_COMMIT_ACCOUNT_AND_ISSUE');
    assert.deepEqual(output,[...input,...Array(64-count).fill(0)]);
    assert.deepEqual(input,before,'source is never modified');
}

// Verify masked-return encodings through the ordinary assembler, not a
// private post-assembly lowering. No service source is patched for tests.
for (const mask of [0, 2]) {
    const a = new global.ChurchAssembler();
    const r = a.assemble(`RETURNAL #${mask}`);
    assert.deepEqual(a.errors, []);
    assert.equal(r.words[0] & 0xfff, mask);
}
console.log('PASS: four draft APIs, native input/result guards, explicit unresolved gates, no success stub');
