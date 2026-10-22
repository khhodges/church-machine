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
assert.deepEqual(compiled.errors, [], 'CREATE source must compile');
assert.equal(compiled.methods.length, 4);
assert.equal(compiled.language, 'assembly');

let faultCount = 0;
for (const [, name, body] of methods) {
    const branches = new Set([...body.matchAll(/^\s*BRANCH(?:EQ|NE|GT|GE|LT|LE|HI|LO|HS)\s+(TODO_\w+)/gm)]
        .map(match => match[1]));
    if (name === 'CREATE') branches.add('TODO_CREATE_DESCRIPTOR_RETIRED');
    if (name === 'MakeOutform') branches.add('TODO_MakeOutform_RESULT_TYPE_AND_IDENTITY');
    if (name === 'MakeInform') branches.add('TODO_MakeInform_RESULT_TYPE_AND_IDENTITY');
    const faults = [...body.matchAll(/^(TODO_\w+):\s*\n\s*HARDFAULT "([^"\n]+)"/gm)];
    assert.equal(faults.length, branches.size, `${name}: every failure branch needs one fault site`);
    for (const [, label, reason] of faults) {
        assert.ok(branches.delete(label), `${name}: unmatched or duplicate fault ${label}`);
        assert.ok(reason.startsWith(`Mint.${name}: `), 'Static reason identifies the method');
        faultCount++;
    }
    assert.equal(branches.size, 0, `${name}: unresolved fault branch`);
    // Other methods explicitly reject execution; they are not implemented.
    for (const [, label] of body.matchAll(/^\s*BRANCH\s+(TODO_\w+)/gm)) {
        if (label === 'TODO_CREATE_DESCRIPTOR_RETIRED') continue;
        assert.match(body, new RegExp(`^${label}:`, 'm'));
    }
}
assert.equal(faultCount, 46, 'Reviewed failures and remaining unsupported methods use HARDFAULT');

for (const [, name, body] of methods) {
    assert.match(body, new RegExp(`^\\s*${name}_inputs:`),
        'Every table entry must reach its own method input checks first');
    if (name === 'CREATE' || name === 'DESTROY') {
        assert.match(body, /LOAD CR1, NULL/);
        assert.doesNotMatch(body, /TODO_CREATE_CLEAR_RESULT_AUTHORITY/);
    } else {
        assert.match(body, new RegExp(`BRANCH TODO_${name}_CLEAR_RESULT_AUTHORITY`));
    }
    assert.doesNotMatch(body, /^\s*TPERM\s+CR\d+,\s*CLEAR/m,
        'No method may use a permission test as capability erasure');
    assert.match(body, /IADD DR1, DR0, #0/);
    if (name !== 'CREATE') assert.doesNotMatch(body, /IADD DR1, DR0, #1\b/,
        'Unsupported methods must not manufacture success');
    for (const label of body.match(/TODO_\w+/g) || []) {
        assert.ok(label.startsWith(`TODO_${name}_`), `${label} must identify API method ${name}`);
    }
    assert.match(body, new RegExp(`TPERM CR2, NULL\\s+BRANCHEQ TODO_${name}_INPUT_CREDENTIAL_NULL`));
    assert.match(body, new RegExp(`TPERM CR3, R\\s+BRANCHNE TODO_${name}_INPUT_PROOF_READ`));
    assert.match(body, new RegExp(`DREAD DR${['CREATE','DESTROY'].includes(name) ? 4 : 2}, CR3, #3`));
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
assert.match(create, /LOAD CR1, CR6, #4\s+CALL CR1, #0/);
assert.match(create, /BRANCH create_v1_allocate/);
assert.doesNotMatch(create, /TODO_CREATE_ALLOWANCE/);
assert.match(create, /TPERM CR4, NULL\s+BRANCHNE TODO_CREATE_INPUT_DATA_SOURCE_NOT_NULL/);
assert.doesNotMatch(create, /SOURCE_EXTENT|SOURCE_EXCEEDS|create_data_copy/);
assert.doesNotMatch(create, /^\s*DREAD\s+\w+,\s*CR4\b/m,
    'Data CREATE must never read a source payload');
assert.ok([...create.matchAll(/^\s*DREAD\s+\w+,\s*(CR\d+)/gm)]
    .every(m=>['CR3','CR7','CR8','CR10'].includes(m[1])),
    'Reads are confined to proof, private state and Namespace metadata, never caller payload');
assert.match(create, /create_data_set_slot:[\s\S]*?BRANCH create_data_slot_lambda/);
assert.doesNotMatch(create, /\.pet create_data_slot_lambda|^\s*LAMBDA\b/m);
const continuation = create.slice(create.indexOf('create_data_slot_after_clear:'),
    create.indexOf('create_data_account_and_issue:'));
assert.doesNotMatch(continuation, /TPERM CR(?:8|9|10), NULL|TODO_CREATE_SLOT_RELEASE_EXCLUSION/);
assert.doesNotMatch(create, /^\s*TPERM\s+CR\d+,\s*CLEAR/m,
    'TPERM CLEAR is a test, never authority erasure');
const slotBody=create.slice(create.indexOf('create_data_slot_lambda:'));
assert.doesNotMatch(slotBody, /^\s*(CALL|CHANGE|SWITCH|LAMBDA)\b/m);
assert.doesNotMatch(slotBody, /TODO_CREATE_CLEAR_NS_AUTHORITY/);
assert.doesNotMatch(slotBody, /TODO_CREATE_SLOT_RELEASE_EXCLUSION|RETURNAL #/);
assert.match(slotBody, /create_data_slot_return:[\s\S]*BRANCH create_data_slot_after_clear/);
assert.doesNotMatch(create.slice(0,create.indexOf('create_data_allocate:')),
    /^\s*(?:DREAD|DWRITE|LOAD).*CR10\b/m,
    'Namespace access is confined to the private Lambda; continuation only checks NULL');
assert.match(create, /create_data_allocate:[\s\S]*LOAD CR7, CR6, #1[\s\S]*LOAD CR8, CR6, #3/);
assert.match(create, /LOAD CR1, CR9, #0/);
assert.match(create, /BRANCHNE TODO_CREATE_RESULT_TYPE/);
assert.ok(destroy.indexOf('TPERM CR7, EXACT, CR11') >= 0);
assert.ok(destroy.indexOf('TPERM CR7, EXACT, CR11') < destroy.indexOf('destroy_body:'));

// Walk the actual draft's scalar/zeroing instructions, NOT unresolved services.
// Native syntax is independently checked above. This is not full Mint acceptance.
const guards=create.slice(create.indexOf('create_data_scalar_checks:')).split('\n')
    .map(s=>s.split(';')[0].trim()).filter(Boolean);
const labels=new Map(guards.map((s,i)=>[s.endsWith(':')?s.slice(0,-1):'',i]));
function walk(start, dr, destination=[], namespace=[], corruptRead=-1) {
    let cmp=0;
    dr.DR0=0;
    for(let pc=labels.get(start),steps=0;pc<guards.length && steps++<10000;pc++) {
        const line=guards[pc];
        // This walker does NOT simulate capability erasure or RETURN.
        // Real simulator coverage owns that boundary.
        if(line==='create_data_slot_return:') return 'create_data_slot_return';
        // Scalar validation ends here; real native tests exercise the escape
        // comparison. This small walker must not pretend to verify Passkeys.
        if(line==='create_data_authorize:') return 'create_data_authorize';
        if(line.endsWith(':')) continue;
        const [op,...args]=line.replace(/,/g,'').split(/\s+/);
        const value=s=>s.startsWith('#')?Number(s.slice(1)):dr[s];
        if(op==='IADD') dr[args[0]]=(value(args[1])+value(args[2]))>>>0;
        else if(op==='BFEXT') dr[args[0]]=(value(args[1])>>>value(args[2])) & ((2**value(args[3]))-1);
        else if(op==='BFINS') {
            const mask=((2**value(args[3]))-1)<<value(args[2]);
            dr[args[0]]=((value(args[0]) & ~mask) | ((value(args[1])<<value(args[2])) & mask))>>>0;
        }
        else if(op==='DWRITE') {
            assert.ok(['CR8','CR10'].includes(args[1]));
            const memory=args[1]==='CR8'?destination:namespace;
            const i=value(args[2])+value(args[3]);
            assert.ok(i<memory.length,'destination write must be bounded');
            memory[i]=value(args[0])>>>0;
        }
        else if(op==='DREAD') {
            assert.equal(args[1],'CR10','Only Namespace read-back in this fragment');
            const i=value(args[2])+value(args[3]);
            assert.ok(i<namespace.length);
            dr[args[0]]=(namespace[i] ^ (i===corruptRead?1:0))>>>0;
        }
        else if(op==='MCMP') cmp=value(args[0])-value(args[1]);
        else if(op==='SHR') dr[args[0]]=value(args[1])>>>value(args[2]);
        else if(op==='SHL') dr[args[0]]=(value(args[1])<<value(args[2]))>>>0;
        else if(op.startsWith('BRANCH')) {
            const take={BRANCH:true,BRANCHEQ:cmp===0,BRANCHNE:cmp!==0,BRANCHHI:cmp>0}[op];
            assert.notEqual(take,undefined,op);
            if(take) {
                if(args[0].startsWith('TODO_')) return args[0];
                assert.ok(labels.has(args[0]),args[0]);pc=labels.get(args[0])-1;
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
    assert.equal(gate,'create_data_authorize');
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
// Native allocator/package tests own reservation and zeroing evidence; do not
// model trusted history or physical address production in this host walker.

// Test-only prepared descriptors and Namespace view. This verifies exact-slot
// writes/confirmation, NOT legal binding, allocation, exclusion or publication.
const descriptor=[0x80001000,0x12345678,0x87654321,0xffffffff];
for(const slot of [0,1,14,255]) {
    const namespace=Array(256*4).fill(0xa5a5a5a5);
    namespace.fill(0, slot*4, slot*4+4);
    const expected=namespace.slice();
    expected.splice(slot*4,4,...descriptor);
    const dr={DR7:slot,DR8:descriptor[0],DR9:descriptor[1],
        DR10:descriptor[2],DR11:descriptor[3]};
    assert.equal(walk('create_data_slot_offset',dr,[],namespace),
        'create_data_slot_return');
    assert.deepEqual(namespace,expected,'only the selected slot may change');
}
for(let word=0;word<4;word++) {
    const dr={DR7:14,DR8:descriptor[0],DR9:descriptor[1],
        DR10:descriptor[2],DR11:descriptor[3]};
    dr.DR13=56;
    assert.equal(walk('create_data_slot_write',dr,[],Array(1024).fill(0),56+word),
        `TODO_CREATE_SLOT_CONFIRM_WORD${word}`);
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
// Include the Phase 1 verifier in the existing Mint validation workflow.
require('./test_pkverify_phase1');
require('./test_mint_pkverify_call');
require('./test_mint_slot_descriptor');
