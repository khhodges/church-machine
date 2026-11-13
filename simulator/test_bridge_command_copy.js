'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname+'/app-build-approval.js','utf8');
const method = source.slice(source.indexOf('    async copyBridgePairing()'), source.indexOf('    _onTokenInput(val)'));
(async()=>{
 for (const mode of ['native','async','blocked','empty']) {
    const command={value:mode==='empty'?'':'test-command',focus(){},select(){this.selected=true;},setSelectionRange(a,b){this.range=[a,b];}};
    const status={textContent:''};
    let native=0, asyncCopies=0;
    const context={document:{getElementById:id=>id==='baPairCommand'?command:status,
        execCommand:()=>{native++;return mode==='native';}},
        navigator:{clipboard:{writeText:async text=>{asyncCopies++;assert.equal(text,'test-command');if(mode==='blocked')throw Error('Denied');}}}};
    vm.createContext(context);
    const api=vm.runInContext('({'+method+'})',context);
    await api.copyBridgePairing();
    if(mode==='empty'){assert.equal(native,0);assert.match(status.textContent,/Create/);}
    else if(mode==='blocked'){assert.match(status.textContent,/blocked.*Ctrl\+C/);assert(command.selected);}
    else {assert.match(status.textContent,/^Copied/);assert.equal(asyncCopies,mode==='native'?0:1);}
 }
 console.log('PASS bridge copy: synchronous, async, denied, empty');
})().catch(e=>{console.error(e);process.exitCode=1;});
