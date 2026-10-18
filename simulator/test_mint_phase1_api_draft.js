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
    assert.match(body, /DREAD DR2, CR3, #3/);
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
assert.match(create, /DREAD DR2, CR4, #11/);
assert.match(create, /DREAD DR2, CR4, #10/);
assert.match(create, /MCMP DR2, #257/);
assert.match(create, /BRANCH TODO_CREATE_TYPED_INPUTS/);
assert.match(create, /BRANCH TODO_CREATE_RESULT_TYPE/);
assert.ok(destroy.indexOf('TODO_DESTROY_REJECT_RESIDENT_AND_OUTFORM') <
    destroy.indexOf('destroy_body:'));

// Walk only the scalar request guards in the source, not a Mint implementation.
// Native instruction syntax is independently checked by the compiler above.
const guards=create.slice(create.indexOf('create_specific_checks:'),
    create.indexOf('create_typed_checks:')).split('\n')
    .map(s=>s.split(';')[0].trim()).filter(Boolean);
const labels=new Map(guards.map((s,i)=>[s.endsWith(':')?s.slice(0,-1):'',i]));
function requestGate(record) {
    const dr={};let cmp=0;
    for(let pc=0,steps=0;pc<guards.length && steps++<200;pc++) {
        const line=guards[pc];
        if(line.endsWith(':')) continue;
        const [op,...args]=line.replace(/,/g,'').split(/\s+/);
        const value=s=>s.startsWith('#')?Number(s.slice(1)):dr[s];
        if(op==='DREAD') {assert.equal(args[1],'CR4');dr[args[0]]=record[value(args[2])]>>>0;}
        else if(op==='MCMP') cmp=value(args[0])-value(args[1]);
        else if(op==='SHR') dr[args[0]]=value(args[1])>>>value(args[2]);
        else if(op.startsWith('BRANCH')) {
            const take={BRANCH:true,BRANCHEQ:cmp===0,BRANCHNE:cmp!==0,BRANCHHI:cmp>0}[op];
            assert.notEqual(take,undefined,op);
            if(take) {
                if(args[0].startsWith('TODO_') || args[0]==='create_typed_checks') return args[0];
                assert.ok(labels.has(args[0]),args[0]);pc=labels.get(args[0]);
            }
        } else assert.fail('Unsupported guard instruction '+line);
    }
    return 'create_typed_checks';
}
const record=kind=>[257,kind,kind<=5?1:kind===6?2:3,0,0,0,kind<=5?16:0,kind===6?4:8,0,0,0,0];
for(let kind=1;kind<=8;kind++) assert.equal(requestGate(record(kind)),'create_typed_checks');
for(const [kind,word,value,reason] of [
    [1,2,2,'KIND_REQUIRES_INFORM'],[6,2,1,'KIND_REQUIRES_OUTFORM'],
    [7,2,1,'KIND_REQUIRES_ABSTRACT'],[1,6,0,'ALLOCATION_ZERO'],
    [1,7,17,'PAYLOAD_EXCEEDS_ALLOCATION'],[2,7,0,'COMPLETE_OBJECT_MISSING'],
    [6,6,1,'OUTFORM_ALLOCATION_NOT_ZERO'],[6,7,3,'OUTFORM_DESCRIPTOR_LENGTH'],
    [1,8,1,'UNUSED_OWNER_NOT_ZERO'],[1,9,1,'UNUSED_ABSTRACT_PAYLOAD_NOT_ZERO'],
    [7,3,1,'ABSTRACT_DOMAIN_NOT_ZERO'],[7,4,1,'ABSTRACT_PERMISSIONS_NOT_ZERO'],
    [7,6,1,'ABSTRACT_ALLOCATION_NOT_ZERO'],[7,9,0x2000000,'ABSTRACT_PAYLOAD_OVER_25_BITS'],
    [8,9,0xffffffff,'ABSTRACT_PAYLOAD_OVER_25_BITS']
]) {
    const r=record(kind);r[word]=value;
    assert.equal(requestGate(r),'TODO_CREATE_INPUT_'+reason);
}
const boundary=record(7);boundary[9]=0x1ffffff;
assert.equal(requestGate(boundary),'create_typed_checks');

// Verify masked-return encodings through the ordinary assembler, not a
// private post-assembly lowering. No service source is patched for tests.
for (const mask of [0, 2]) {
    const a = new global.ChurchAssembler();
    const r = a.assemble(`RETURNAL #${mask}`);
    assert.deepEqual(a.errors, []);
    assert.equal(r.words[0] & 0xfff, mask);
}
console.log('PASS: four draft APIs, native input/result guards, explicit unresolved gates, no success stub');
