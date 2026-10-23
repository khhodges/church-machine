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
    assert.equal(JSON.parse(writes[0][1].body).bind,false);
    assert.equal(JSON.parse(writes[0][1].body).document.rows[0].selection.filename,'mint.lump');
    assert.equal(design.state.saving,false);
    if(failure) {
        assert.equal(design.state.dirty,true);
        assert.match(design.state.error,/connection lost/);
    } else {
        assert.equal(design.state.dirty,false);
        assert.equal(design.state.fingerprint,'new');
        assert.match(design.state.error,/no GTs were bound/);
        assert.equal(reports.length,0,'Add must not open a binding result');
        await design.save(true);
        assert.equal(JSON.parse(writes[1][1].body).bind,true);
        assert.equal(reports.at(-1).installed,false);
    }
}
(async()=>{
    await run('complete');await run('unresolved');await run('blocked',true);
    console.log('PASS Add saves portable placement; only explicit Bind requests GTs; draft retained on failure');
})().catch(e=>{console.error(e);process.exitCode=1;});
