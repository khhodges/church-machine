'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
async function run(status, failure=false) {
    const elements={
        _nsPlacementName:{value:'ide.Mint'},_nsPlacementSlot:{value:'12'},
        _nsAddSelect:{selectedIndex:1},_nsAddError:{textContent:''},
        _nsAddModalOverlay:{remove(){}},
    };
    const writes=[], reports=[];
    const scope={document:{readyState:'loading',addEventListener(){},
        getElementById:id=>elements[id] || null},
        window:{NamespaceIdeNode:{savePending:async()=>true},
            NamespaceBindingWindows:{invalidate(){},show:r=>reports.push(r)},
            _nsAddAvailableList:[{token:'mint',filename:'mint.lump',binary_hash:'hash',lump_version:2}]},
        fetch:async(url,opts)=>{
            writes.push([url,opts]);
            const payload=JSON.parse(opts.body);
            if(failure) throw Error('connection lost');
            return {ok:true,json:async()=>({ok:true,document:payload.document,
                fingerprint:'new',projection:{rows:[]},persisted:true,
                bindingReport:{status,installed:false,lists:[{slot:12,name:'ide.Mint',
                    status:status==='complete'?'bound':'unresolved',
                    rows:status==='complete'?[]:[{name:'ide.MintState',status:'unresolved',reason:'No target'}]}]}})};
        }};
    vm.createContext(scope);
    vm.runInContext(fs.readFileSync(__dirname+'/namespace-design-v1.js','utf8'),scope);
    const design=scope.window.NamespaceDesignV1;
    design.state.document={rows:[],slotCount:64};
    design.state.fingerprint='old';
    await design.addFromOriginal();
    assert.equal(writes.length,1);
    assert.equal(writes[0][1].method,'PUT');
    assert.equal(JSON.parse(writes[0][1].body).document.rows[0].selection.filename,'mint.lump');
    assert.equal(design.state.saving,false);
    if(failure) {
        assert.equal(design.state.dirty,true);
        assert.match(design.state.error,/connection lost/);
    } else {
        assert.equal(design.state.dirty,false);
        assert.equal(design.state.fingerprint,'new');
        assert.match(design.state.error,status==='complete'?/checks passed/:/Not ready/);
        assert.equal(reports.at(-1).installed,false);
        if(status!=='complete') assert.equal(reports.at(-1).lists[0].rows[0].name,'ide.MintState');
    }
}
(async()=>{
    await run('complete');await run('unresolved');await run('blocked',true);
    console.log('PASS design Add automatically saves and binds; exact selection, missing names, retained draft on failure, no activation');
})().catch(e=>{console.error(e);process.exitCode=1;});
