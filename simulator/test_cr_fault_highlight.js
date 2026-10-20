'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const dom = new JSDOM('<div id="crRegs"></div>');
const cr = Array.from({length:16},()=>({word0:1,word1:100,word2:255,word3:0,m:0}));
const machine = {halted:true,stepCount:17,_currentThreadSlot:12,cr,
    faultLog:[{step:17,threadSlot:12,rawDiagnosticReason:'DWRITE: CR11: lacks W permission',
        crSnapshot:cr.map(r=>({...r}))}],
    getFormattedCR:()=>({isNull:false,word0_gt:'00000001',perms:'-R-----',
        word1_location:100,gtTypeName:'Inform',mBit:0,limit17:255,sealCRC:0}),
    parseGT:()=>({type:1}),nsLabels:{}};
const source = fs.readFileSync(__dirname+'/app-cr-display.js','utf8');
const render = new Function('sim','document','_petNameCRMap',
    source+';return updateCRDisplay;')(machine,dom.window.document,{});
function check(expected) {
    render();
    assert.equal(dom.window.document.querySelectorAll('.cr-fault-row').length,expected?1:0);
}
check(true);
assert.equal(dom.window.document.querySelector('.cr-fault-row').dataset.faultCr,'11');
assert.match(dom.window.document.querySelector('.cr-fault-summary').textContent,/CR11: W permission missing/);
assert.equal(dom.window.document.querySelector('.cr-fault-permission').textContent,'W missing');
assert.equal(dom.window.document.querySelector('.cr-fault-row').getAttribute('onclick'),'openCRDetail(11)');
machine.halted=false; check(false); machine.halted=true;
machine.stepCount++; check(false); machine.stepCount--;
machine._currentThreadSlot=2; check(false); machine._currentThreadSlot=12;
machine.cr[11].word0=2; check(false); machine.cr[11].word0=1;
machine.faultLog[0].rawDiagnosticReason='CR6 and CR11 disagree'; check(false);
machine.faultLog[0].rawDiagnosticReason='DWRITE: CR11 <script>bad</script>'; check(true);
assert.equal(dom.window.document.querySelectorAll('script').length,0);
machine.faultLog=[]; check(false);
dom.window.close();
console.log('PASS CR fault highlight: CR11/W, row inspection, stale/reset containment, ambiguous evidence and escaping');
