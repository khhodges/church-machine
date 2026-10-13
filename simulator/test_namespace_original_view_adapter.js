'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const nodes={
    _nsPlacementName:{value:'ide.Mint'},
    _nsPlacementSlot:{value:'14'},
    _nsAddError:{textContent:''},
    _nsAddSelect:{selectedIndex:0},
    _nsAddModalOverlay:{remove(){this.removed=true;}},
};
const context={
    console,
    document:{readyState:'loading',addEventListener(){},getElementById:id=>nodes[id]||null},
    updateNamespace(){},
    _nsState:{abstractions:[{slot:0,name:'Boot.NS'}]},
    _nsShowIdentity(slot,row){context.inspected={slot,row};},
    _nsRenderSavedVersionCell(row){return `<td class="ns-saved-version-cell">v${row.lump_version||'NA'}</td>`;},
};
context.window=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('simulator/namespace-design-v1.js','utf8'),context);
const api=context.NamespaceDesignV1;
const rows=[
    {slot:1,name:'Boot.NS',kind:'namespace',policy:'Resident',sequence:0},
    {slot:2,name:'Boot.Thread',kind:'thread',policy:'Resident',sequence:0,words:256},
    {slot:7,name:'WukongCallHome',kind:'lump',policy:'Resident',sequence:0,
        selection:{revision:20,token:'232f0de4'}},
    {slot:8,name:'UART_DEV',kind:'mmio',policy:'Hardware',sequence:1,address:0x40000014,limit:2},
    {slot:10,name:'CapabilityTest',kind:'lump',policy:'Resident',sequence:0,boot:true},
];
api.state.document={format:'ascending-nst-metadata-slot0-v1',rows};
api.state.projection={warnings:[],rows:rows.map(r=>({...r,location:512,limit:127}))};
api.state.fingerprint='test-fingerprint';
const source=fs.readFileSync('simulator/app-memory.js','utf8');
assert.match(source,/NamespaceDesignV1\.renderRows\(html, container\)/);
assert.match(source,/<th>Idx<\/th><th class="ns-saved-version-col">v#<\/th>/);
assert.match(source,/<th>W1: Type<\/th><th>W1: F<\/th><th>W1: G<\/th><th>W1: Limit<\/th>/);
const controls={};
const host={innerHTML:'',querySelector:selector=>controls[selector]||=( {textContent:''} ),
    querySelectorAll:()=>[]};
api.renderRows('<table class="ns-table"><tbody>',host);
assert.match(host.innerHTML,/0xF8810100/);
assert.match(host.innerHTML,/id="ns-row-1"[\s\S]*?Boot.NS/);
assert.match(host.innerHTML,/id="ns-row-2"[\s\S]*?Boot.Thread/);
assert.match(host.innerHTML,/id="ns-row-8"[\s\S]*?UART_DEV[\s\S]*?0x40000014/);
assert.match(host.innerHTML,/ns-row-9[\s\S]*?\(no entry installed\)/);
assert.match(host.innerHTML,/Load policy for slot 7/);
assert.match(host.innerHTML,/Open LUMP/);
assert.equal((host.innerHTML.match(/id="ns-row-/g)||[]).length,11);
assert.match(host.innerHTML,/ns-saved-version-cell">v20/);
assert.doesNotMatch(host.innerHTML,/jumpToMemory|setBootEntrySlot|_nsTableClear\(/,
    'new design controls must never operate on old runtime slots');
api.identity(7);
assert.equal(context.inspected.row.name,'WukongCallHome');
(async()=>{
    await api.addFromOriginal();
    assert.equal(api.state.document.rows.find(r=>r.slot===14).name,'ide.Mint');
    assert.equal(nodes._nsAddModalOverlay.removed,true);
    assert.equal(context._nsState.abstractions[0].slot,0,'legacy state untouched');
    api.policy(14,'Resident');
    assert.equal(api.state.document.rows.find(r=>r.slot===14).policy,'Resident');
    api.boot(7);
    assert.equal(api.state.document.rows.filter(r=>r.boot).length,1);
    assert.equal(api.state.document.rows.find(r=>r.boot).slot,7);
    api.state.saving=true;
    nodes._nsPlacementName.value='Other.Name';
    nodes._nsPlacementSlot.value='15';
    await api.addFromOriginal();
    assert.equal(api.state.document.rows.some(r=>r.slot===15),false);
    console.log('PASS original Namespace columns, new rows, original ADD adapter, identity and isolated draft actions');
})().catch(e=>{console.error(e);process.exitCode=1;});
