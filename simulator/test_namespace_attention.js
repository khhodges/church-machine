'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = [];
function element(tag) {
    const e = {tag, children:[], style:{}, attrs:{}, isConnected:true,
        setAttribute(k,v) { this.attrs[k]=v; },
        appendChild(n) { this.children.push(n); return n; },
        replaceChildren(...nodes) { this.children=nodes; },
        addEventListener(k, fn) { this[k+'Handler']=fn; },
        remove() { this.isConnected=false; }, showModal(){this.open=true;},
        close(){this.open=false;this.closeHandler?.();}, focus(){}};
    elements.push(e); return e;
}
const calls=[];
const storage = new Map();
const scope={document:{createElement:element, body:element('body'),
    getElementById:id=>elements.find(e=>e.isConnected && e.attrs.id===id)},
    window:{NamespaceDesignV1:{state:{active:true,profile:'phase1',dirty:true}},
        localStorage:{getItem:k=>storage.get(k) || null, setItem:(k,v)=>storage.set(k,v)}},
    fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({
        ok:true,profile:'phase1',checkedAt:'now',scope:'saved',
        items:[{name:'<unsafe>',category:'missing resource',detail:'missing',evidence:'test'}]
    })};}};
vm.runInNewContext(fs.readFileSync(__dirname+'/namespace-attention.js','utf8'),scope);
const ui=scope.window.NamespaceAttention;
(async()=>{
    const first=ui.open();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls[0].url,'/api/namespace/attention?profile=phase1');
    assert.equal(calls[0].options.cache,'no-store');
    assert(elements.some(e=>e.attrs['data-attention-dirty']==='1'));
    assert(elements.some(e=>e.tag==='strong' && e.textContent==='<unsafe>'));
    first.close();
    scope.window.NamespaceDesignV1.state.active=false;
    ui.open();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.length,2);
    assert.equal(calls[1].url,'/api/namespace/attention?profile=legacy');
    assert(calls.every(c=>!c.options.method || c.options.method==='GET'));
    const body = element('div');
    const item = {name:'Mint',category:'unfinished implementation',detail:'not implemented',evidence:'source'};
    const data = {profile:'phase1',items:[item]};
    function descendants(e) { return [e,...e.children.flatMap(descendants)]; }
    function find(attr) { return descendants(body).find(e=>e.attrs[attr]); }
    function checkbox() { return descendants(body).find(e=>e.tag==='input'); }
    ui.renderReport(body,data);
    assert.equal(find('data-attention-item').tag,'details');
    assert(!find('data-attention-item').open, 'issue details start collapsed');
    assert.equal(find('data-attention-queue').children.length,1);
    checkbox().checked=true;
    checkbox().onchange();
    assert.equal(find('data-attention-queue').children.length,0);
    assert.equal(checkbox().checked,true);
    ui.renderReport(body,data);
    assert.equal(find('data-attention-queue').children.length,0,'reopening remembers ignore');
    ui.renderReport(body,{...data,profile:'legacy'});
    assert.equal(find('data-attention-queue').children.length,1,'profiles are isolated');
    ui.renderReport(body,{...data,items:[{...item,detail:'different unfinished work'}]});
    assert.equal(find('data-attention-queue').children.length,1,'changed evidence reappears');
    ui.renderReport(body,data);
    checkbox().checked=false;
    checkbox().onchange();
    assert.equal(find('data-attention-queue').children.length,1,'unchecking restores issue');
    scope.window.localStorage.setItem=()=>{throw Error('full');};
    checkbox().checked=true;
    checkbox().onchange();
    assert.equal(find('data-attention-queue').children.length,1,'failed persistence never hides issue');
    assert.equal(checkbox().checked,false);
    assert(descendants(body).some(e=>String(e.textContent).includes('Could not save')));
    console.log('PASS fresh read-only requests, safe text, collapsed details, ignore/restore, persistence, profile isolation, changed evidence and storage failure');
})().catch(e=>{console.error(e);process.exitCode=1;});
