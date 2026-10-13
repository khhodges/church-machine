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
for (const name of ['ide.Thread.2', 'ide.Thread.3']) {
    const result = compiler.compile(source(name), []);
    assert.deepEqual(global.ChurchAssembler.objectNameErrors({
        abstractionName: name, capabilities: []
    }), []);
    assert.deepEqual(result.errors, [], name);
    const binary = buildLump(result);
    assert.equal(buildApiDefinition(result, binary.words).capabilities[1].name, name);
    assert.equal(binary.words[binary.clistStart + 1], 0);
}
for (const name of ['ide..Thread', 'ide.Thread.', '.Thread.2', '2', '2.Thread']) {
    assert(global.ChurchAssembler.objectNameErrors({
        abstractionName: 'ide.Example', capabilities: [{ name }]
    }).length, `malformed/unqualified name ${name} remains invalid`);
}
for(const name of ['UART','UART_TX','UART_RX','LED0','UART_DEV','Service','0x40000014']) {
    assert(compiler.compile(source(name),[]).errors.length,`${name} must not compile as object identity`);
    const forged={...good,capabilities:[good.capabilities[0],{name,rights:['R','W']}]};
    assert.throws(()=>buildLump(forged),/canonical dot-name/);
    assert.throws(()=>buildApiDefinition(forged,[]),/canonical dot-name/);
}
assert(compiler.compile(source('ide.UART','Example'),[]).errors.some(e=>/LUMP object/.test(e.message)));
// Canonical-name diagnostics must point to editor declarations, not uses or
// generated assembly. Preserve CRLF and ignore misleading names in comments.
for (const newline of ['\n', '\r\n']) {
    const raw = ['; heading', '; Abstraction: WukongCallHome', '',
        'capabilities { SELF,', ' ; LED0 and UART_TX are mentioned here',
        ' LED0 RW,', ' UART_TX W', '}', 'NOP'].join(newline);
    const errors = compiler.compile(raw, [], {language:'assembly'}).errors
        .filter(e=>/canonical dot-name/.test(e.message));
    assert.deepEqual(errors.map(e=>e.line),[2,6,7]);
    assert.deepEqual(errors.map(e=>raw.split(newline)[e.line-1].slice(e.colStart,e.colEnd)),
        ['WukongCallHome','LED0','UART_TX']);
}
const jsErrors = compiler.compile(source('UART_TX','Example'),[]).errors
    .filter(e=>/canonical dot-name/.test(e.message));
assert.deepEqual(jsErrors.map(e=>e.line),[1,2]);
assert.deepEqual(jsErrors.map(e=>source('UART_TX','Example').split('\n')[e.line-1].slice(e.colStart,e.colEnd)),
    ['Example','UART_TX']);
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
    for (const name of ['ide.Thread.2', 'ide.Thread.3']) {
        const numeric = run(source(name));
        assert.equal(numeric.ok, true, JSON.stringify(numeric));
    }
    const rejected=run(source('UART_TX'));
    assert.equal(rejected.ok,false);
    assert.match(rejected.error,/canonical dot-name/);
}
function processExec(){return process.execPath;}
const foreignSource = [
    '// ide.SelfTest in a comment is not a declaration',
    'abstraction ide.CapabilityTest {',
    ' capabilities {',
    '  SELF E,',
    '  ide.SelfTest E,',
    '  ide.LED_DEV RW,',
    '  ide.UART_DEV RW,',
    '  ide.BTN_DEV R,',
    '  ide.TIMER_DEV RW,',
    '  ide.M_BIT_DEV RW,',
    '  ide.WukongCallHome E,',
    '  ide.Thread.2,',
    '  ide.Thread.3,',
    '  Boot.Thread',
    ' }',
    ' method Run() { return 1; }',
    '}'
].join('\n');
const foreignRun = spawnSync(process.execPath,['server/compile_worker.js'],{
    input:JSON.stringify({source:foreignSource,language:'auto',_ide_hierarchy:{
        node:'ide1', aliases:{'Boot.Thread':'ide1.BootThread'},definitions:{}
    }}),encoding:'utf8',timeout:15000});
assert.equal(foreignRun.status,0,foreignRun.stderr);
const foreignResult=JSON.parse(foreignRun.stdout);
const ownershipErrors=foreignResult.errors;
assert.equal(ownershipErrors.filter(e=>/Foreign leaf/.test(e.message)).length,7);
assert.equal(ownershipErrors.filter(e=>/Malformed canonical leaf/.test(e.message)).length,2);
assert.equal(ownershipErrors.length,9,JSON.stringify(foreignResult.errors));
assert.deepEqual(ownershipErrors.map(e=>e.line),[5,6,7,8,9,10,11,12,13]);
assert.deepEqual(ownershipErrors.map(e=>foreignSource.split('\n')[e.line-1].slice(e.colStart,e.colEnd)),
    ['ide.SelfTest','ide.LED_DEV','ide.UART_DEV','ide.BTN_DEV','ide.TIMER_DEV',
        'ide.M_BIT_DEV','ide.WukongCallHome','ide.Thread.2','ide.Thread.3']);
console.log('PASS canonical MMIO dot-names: compiler, API/binary builders, raw operand resolution, and server worker');
