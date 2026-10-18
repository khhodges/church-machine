'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
let html='', opens=[], valid=true;
const context={
    document:{readyState:'loading',addEventListener(){},getElementById(){return null;},
        createElement(){return {style:{},set innerHTML(s){html=s;},querySelector(){return {};}};},
        body:{appendChild(){}}},
    _captureEditorWriteGuard:()=>({accepts:()=>valid}),
    openSourceFile:async(path,options)=>opens.push({path,options}),
    fetch:async()=>({ok:true,json:async()=>[]})
};
context.window=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname+'/namespace-design-v1.js','utf8'),context);
const api=context.NamespaceDesignV1;api.state.profile='phase1';
api.state.document={slotCount:256,rows:[
    {slot:9,name:'ide.Mint',kind:'lump'},
    {slot:3,name:'LED_DEV',kind:'mmio',address:0x40000000,limit:4,sequence:0,policy:'Hardware'},
    {slot:14,name:'nstab',kind:'lump'},
    {slot:15,name:'pkverify',kind:'lump'},
    {slot:16,name:'ide.Alace',kind:'lump'},
    {slot:2,name:'Boot.Thread',kind:'thread',words:256,sequence:0,policy:'Resident'},
    {slot:6,name:'SelfTest',kind:'lump'},
    {slot:7,name:'WukongCallHome',kind:'lump'},
    {slot:10,name:'CapabilityTest',kind:'lump'},
    {slot:17,name:'ide.Mallory',kind:'lump'},
]};
const before=JSON.stringify(api.state.document);
(async()=>{
    for(const slot of [9,6,7,10,16,17]){
        await api.source(slot);
        const call=opens.at(-1);
        assert.ok(fs.existsSync(__dirname+'/../'+call.path));
        assert.equal(call.options.showEditor,true);
        assert.equal(typeof call.options.writeGuard.accepts,'function');
        assert.equal(call.options.accepts(),true);
    }
    assert.equal(opens[0].path,'simulator/cloomc/mint.cloomc');
    assert.match(opens[4].options.reason,/ide.Alace.*ide.Alice/);
    const last=opens.at(-1);await api.source(3);
    assert.equal(last.options.accepts(),false,'another label invalidates pending source open');
    assert.match(html,/MMIO target/);assert.match(html,/0x40000000/);
    await api.source(14);assert.match(html,/Namespace table target/);assert.match(html,/256 slots/);
    await api.source(2);assert.match(html,/Thread target/);
    await api.source(15);assert.match(html,/Current interface definition/);
    assert.match(html,/#docs\?doc=/);
    await api.source(9);valid=false;
    assert.equal(opens.at(-1).options.accepts(),false);
    valid=true;api.state.profile='ascending';
    assert.equal(opens.at(-1).options.accepts(),false);
    assert.equal(JSON.stringify(api.state.document),before);
    console.log('PASS Phase 1 label targets: current sources, MMIO, nstab, Thread, verifier definition, spelling disclosure, races and unchanged placement');
})().catch(e=>{console.error(e);process.exitCode=1;});
