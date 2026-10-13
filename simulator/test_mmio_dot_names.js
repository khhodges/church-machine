'use strict';
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
global.ChurchAssembler=require('./assembler');
const Compiler=require('./cloomc_compiler');
const {buildLump,buildApiDefinition}=require('./lump_builder');
const source=(cap='ide.UART',name='ide.Example')=>`abstraction ${name} {
 capabilities { ${cap} RW, ide.LED RW }
 method Run() {
   return 1;
 }
}`;
const compiler=new Compiler();
const good=compiler.compile(source(),[]);
assert.deepEqual(good.errors,[]);
assert.deepEqual(good.capabilities.map(c=>c.name),['SELF','ide.UART','ide.LED']);
const lump=buildLump(good);
assert.equal(lump.words[lump.clistStart+1],0,'portable UART dependency remains unbound');
assert.equal(lump.words[lump.clistStart+2],0,'portable LED dependency remains unbound');
assert.deepEqual(buildApiDefinition(good,lump.words).capabilities.map(c=>c.name),['SELF','ide.UART','ide.LED']);
for(const name of ['UART','UART_TX','UART_RX','LED0','UART_DEV','Service','0x40000014']) {
    assert(compiler.compile(source(name),[]).errors.length,`${name} must not compile as object identity`);
    const forged={...good,capabilities:[good.capabilities[0],{name,rights:['R','W']}]};
    assert.throws(()=>buildLump(forged),/canonical dot-name/);
    assert.throws(()=>buildApiDefinition(forged,[]),/canonical dot-name/);
}
assert(compiler.compile(source('ide.UART','Example'),[]).errors.some(e=>/LUMP object/.test(e.message)));
const another=compiler.compile(source('other.UART'),[]);
assert.deepEqual(another.errors,[]);
assert.notDeepEqual(buildApiDefinition(good,lump.words),buildApiDefinition(another,buildLump(another).words),
    'exact programmer-supplied namespace remains in embedded API input');
const asm=new global.ChurchAssembler();
assert(asm.assemble('LOAD CR3, UART_TX').errors.length,'no implicit UART boot slot');
assert(asm.assemble('LOAD CR3, LED0').errors.length,'no implicit LED boot slot');
const raw=asm.assemble('capabilities { SELF, ide.UART RW }\nLOAD CR3, ide.UART');
assert.deepEqual(raw.errors,[]);
for(const language of ['auto','javascript']) {
    const run=src=>{
        const process=spawnSync(processExec(),['server/compile_worker.js'],{
            input:JSON.stringify({source:src,language}),encoding:'utf8',timeout:15000});
        assert.equal(process.status,0,process.stderr);
        return JSON.parse(process.stdout);
    };
    const accepted=run(source());
    assert.equal(accepted.ok,true,JSON.stringify(accepted));
    const rejected=run(source('UART_TX'));
    assert.equal(rejected.ok,false);
    assert.match(rejected.error,/canonical dot-name/);
}
function processExec(){return process.execPath;}
console.log('PASS canonical MMIO dot-names: compiler, API/binary builders, raw operand resolution, and server worker');
