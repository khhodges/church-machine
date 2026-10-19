'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const nodes = [], intervals = new Set(), ticks = [];
function element() {
    const children = {}, handlers = {};
    const n = {textContent:'', open:false, hidden:false, style:{},
        setAttribute() {}, appendChild() {}, scrollHeight:0,
        querySelector: s => children[s] ||= element(),
        addEventListener: (name, f) => {handlers[name] = f;},
        showModal() {this.open = true;}, close() {this.open = false; handlers.close?.();}};
    nodes.push(n); return n;
}
const scope = {window:{}, document:{head:element(),body:element(),createElement:element},
    Date, Promise, setTimeout: f => ticks.push(f),
    setInterval: f => {intervals.add(f);return f;}, clearInterval: f => intervals.delete(f)};
vm.createContext(scope);
vm.runInContext(fs.readFileSync(__dirname+'/compile-progress.js','utf8'),scope);
const progress=scope.window.CompileProgress;
(async()=>{
    let started=false, resolve;
    const pending=progress.run(()=>{started=true;return new Promise(r=>{resolve=r;});});
    const dialog=nodes.find(n=>n.id==='compileProgressDialog'), log=dialog.querySelector('pre');
    assert(dialog.open,'modal opens synchronously before work');
    assert.equal(started,false,'paint opportunity before synchronous compiler work');
    ticks.shift()(); await new Promise(setImmediate);
    assert(started);
    progress.stage('Waiting for server');
    assert.match(log.textContent,/Waiting for server/);
    dialog.querySelector('button').onclick();
    assert.equal(intervals.size,1,'hiding does not cancel the operation');
    const reopen=nodes.find(n=>n.id==='compileProgressReopen');
    assert.equal(reopen.hidden,false);
    reopen.onclick(); assert(dialog.open);
    resolve({ok:true}); const result=await pending;
    assert.equal(result.ok,true); assert.equal(intervals.size,0);
    assert.match(log.textContent,/Candidate ready/);
    assert(dialog.open,'successful manual compile keeps its log available');
    const bad=progress.run(()=>({ok:false,error:'Line 85: invalid <operand>'}));
    ticks.shift()(); await bad;
    assert.match(log.textContent,/Line 85: invalid <operand>/);
    assert.equal(intervals.size,0);
    assert(dialog.open,'failure remains visible');
    const exception=progress.run(()=>{throw Error('server disconnected');});
    ticks.shift()(); await assert.rejects(exception,/server disconnected/);
    assert.match(log.textContent,/server disconnected/);
    assert.equal(intervals.size,0);
    const save=progress.run(()=>({ok:true}),{closeOnSuccess:true});
    ticks.shift()(); await save;
    assert.equal(dialog.open,false,'successful Save compilation releases the review dialog');
    console.log('PASS compile progress: immediate display, paint yield, stages, hide/reopen, results/errors and timer cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
