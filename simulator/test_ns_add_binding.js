'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/app-memory.js`, 'utf8');
const code = source.slice(source.indexOf('async function _nsAddPlacementConfirm()'),
    source.indexOf('async function _nsOpenNewAssembler()'));
async function check(status, networkFailure=false, saveFailure=false) {
    const calls=[];
    const els={_nsPlacementName:{value:'ide.Mint'},_nsPlacementSlot:{value:'12'},
        _nsAddSelect:{selectedIndex:1},_nsAddPlacementBtn:{disabled:false},
        _nsAddError:{textContent:''},nsSaveLayoutNote:{textContent:''},
        _nsAddModalOverlay:{remove(){calls.push('close');}}};
    const record={token:'mint',filename:'mint.lump',binary_hash:'hash',lump_version:2};
    const report={lists:[{slot:12,status,rows:status==='bound'?[]:
        [{name:'ide.MintState',status:'unresolved',reason:'No Namespace target'}]}]};
    const context={document:{getElementById:id=>els[id]},sim:{},
        window:{_nsState:{namespaceFingerprint:'exact'},_nsAddAvailableList:[record],
            _nsTableSave:async()=>{calls.push('save');return !saveFailure;},
            NamespaceBindingWindows:{show:r=>calls.push(r)}},
        _nsStageDesignPlacement:()=>{calls.push('stage');return {slot:12};},
        _setNsDirty(){},updateNamespace(){},
        fetch:async(url,opts)=>{
            assert.equal(url,'/api/namespace/bind-placements');
            assert.equal(opts.headers['X-Requested-With'],'NamespaceDesign');
            assert.equal(JSON.parse(opts.body).namespaceFingerprint,'exact');
            assert.equal(calls[1],'save');
            calls.push('bind');
            if(networkFailure) throw Error('offline');
            return {};
        },
        _actionableJsonResponse:async()=>({bindingReport:report})};
    vm.runInNewContext(code,context);
    await context._nsAddPlacementConfirm();
    if(saveFailure) {
        assert(!calls.includes('bind'));
        assert.match(els._nsAddError.textContent,/remains local/);
        assert.equal(els._nsAddPlacementBtn.textContent,'Add to Namespace');
    } else {
        assert.equal(els._nsAddPlacementBtn.textContent,'Close');
        assert.match(els._nsAddError.textContent,/Placement saved/);
        assert.match(els._nsAddError.textContent,/no GTs were bound/);
        assert(!calls.includes('bind'),'Add must not call the linker');
        context.window._nsTableDirty=true;
        await context._nsBindPlacements({});
        assert(!calls.includes('bind'),'BIND must not use unsaved placements');
        context.window._nsTableDirty=false;
        await context._nsBindPlacements({});
        assert(calls.includes('bind'),'explicit BIND calls the linker');
        if(networkFailure) assert.match(els.nsSaveLayoutNote.textContent,/Binding failed: offline/);
        els._nsAddPlacementBtn.onclick();
        assert(calls.includes('close'));
    }
}
(async()=>{
    await check('bound');await check('unresolved');await check('blocked',true);
    await check('bound',false,true);
    assert(!source.slice(source.indexOf('function _nsTableAdd()'),
        source.indexOf('function _nsUpdatePlacementButton()')).includes('id="_nsAddConfirmBtn"'));
    console.log('PASS legacy Add saves without binding; explicit BIND handles saved placements and errors');
})().catch(e=>{console.error(e);process.exitCode=1;});
