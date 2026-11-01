const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('simulator/app-run.js','utf8');
const record={_goldenReference:true,_hardwareTrace:{gt_label:'@phase1 event FAULT Boot.NS / Thread.3 / ide.Mallory'}};
const overlay={_faultRecord:record};
let dismissed=0, opened=[], notices=[], badHash=false;
const binding={token:'0fe63f75',revision:3,sha256:'expected-hash'};
const scope={window:{},document:{getElementById:id=>id==='faultModalOverlay'?overlay:{prepend:()=>{}},
    createElement:()=>({setAttribute:()=>{},style:{}})},
    _FAULT_GOLDEN_REFERENCE:{bit:'golden',lumps:{'ide.Mallory':binding}},
    fetch:async url=>{assert.equal(url,'/api/lumps/0fe63f75/detail');return {ok:true,json:async()=>({
        abstraction:'ide.Mallory',token:binding.token,lump_version:3,binary_hash:badHash?'wrong':binding.sha256})};},
    switchView:view=>assert.equal(view,'lumps'),
    showLumpDetail:(...args)=>opened.push(args),
    faultModalDismiss:()=>dismissed++,
    _showFpgaToast:(...args)=>notices.push(args)};
vm.createContext(scope);
vm.runInContext(source.slice(source.indexOf('function _faultSummaryName('),
    source.indexOf('function faultModalDismiss(')),scope);
(async()=>{
    assert.equal(scope._faultSummaryName(record),'ide.Mallory');
    assert.equal(scope._faultSummaryName({_hardwareTrace:{gt_label:'unresolved'}}),null);
    await scope.faultModalOpenLumpSummary();
    assert.equal(opened[0][0],'0fe63f75');
    assert.equal(opened[0][1].assignedLump.lump_version,3);
    assert.equal(dismissed,1);
    badHash=true;
    await scope.faultModalOpenLumpSummary();
    assert.equal(dismissed,1,'hash mismatch keeps the fault report open');
    assert.equal(opened.length,1,'never substitute a newer or mismatched revision');
    scope.fetch=async()=>{throw Error('offline');};
    await scope.faultModalOpenLumpSummary();
    assert.equal(dismissed,1);
    assert.match(notices.at(-1)[1],/Nothing changed/);
    console.log('PASS fault summary link: exact build revision, hash mismatch, unavailable and errors');
})().catch(e=>{console.error(e);process.exit(1)});
