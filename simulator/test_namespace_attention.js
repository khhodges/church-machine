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
const scope={document:{createElement:element, body:element('body'),
    getElementById:id=>elements.find(e=>e.isConnected && e.attrs.id===id)},
    window:{NamespaceDesignV1:{state:{active:true,profile:'phase1',dirty:true}}},
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
    console.log('PASS fresh read-only requests, profile, dirty warning and safe text rendering');
})().catch(e=>{console.error(e);process.exitCode=1;});
