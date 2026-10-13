'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const elements = Object.fromEntries(['Form','Input','Save','Reload','Status'].map(name =>
    ['namespaceIdeNode' + name, {value:'', disabled:false, textContent:'', events:{},
        addEventListener(event, callback) { this.events[event] = callback; }}]));
const original = {node:'kjhh1',aliases:{'Thread.2':'kjhh1.Thread2'},definitions:{}};
let saved = original, confirm = false, puts = 0;
const messages = [];
vm.runInNewContext(fs.readFileSync(__dirname + '/namespace-ide-node.js', 'utf8'), {
    document:{getElementById:id=>elements[id]},
    window:{confirm:message=>{messages.push(message);return confirm;}},
    fetch:async (url, options)=>{
        assert.equal(url, '/api/ide-hierarchy');
        if(options.method === 'PUT') {
            puts++;
            const body = JSON.parse(options.body);
            assert.deepEqual(body.expected, original);
            assert.equal(body.confirmed,true);
            saved = {node:body.node,aliases:{'Thread.2':'ide.Thread2'},definitions:{}};
        }
        return {ok:true,json:async()=>saved};
    }
});
(async()=>{
    await new Promise(resolve=>setImmediate(resolve));
    const input = elements.namespaceIdeNodeInput;
    assert.equal(input.value,'kjhh1');
    input.value = 'ide'; input.events.input();
    assert.equal(elements.namespaceIdeNodeSave.disabled,false);
    await elements.namespaceIdeNodeForm.events.submit({preventDefault(){}});
    assert.equal(puts,0,'cancel must not save');
    confirm = true;
    await elements.namespaceIdeNodeForm.events.submit({preventDefault(){}});
    assert.equal(puts,1);
    assert(messages.some(m=>m.includes('Thread.2: kjhh1.Thread2 → ide.Thread2')));
    assert.match(elements.namespaceIdeNodeStatus.textContent,/Saved IDE node: ide/);
    assert.equal(elements.namespaceIdeNodeSave.disabled,true);
    await elements.namespaceIdeNodeReload.events.click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(input.value,'ide');
    console.log('PASS Namespace IDE node: load, confirmation, cancellation, save and reload');
})().catch(error=>{console.error(error);process.exitCode=1;});
