'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
async function run(confirmed, nodeFails = false, stale = false, mismatchedReadback = false) {
    const elements = Object.fromEntries(['Form','Input','Save','Reload','Status'].map(key =>
        ['namespaceIdeNode' + key, {value:'', events:{}, addEventListener(name, fn) {this.events[name]=fn;}}]));
    const writes = [];
    let config = {node:'ide', aliases:{}, definitions:{}};
    const scope = {
        document:{readyState:'loading',addEventListener(){},getElementById:id=>elements[id]},
        window:{confirm:()=>confirmed,addEventListener(){}},
        fetch:async (url, options) => {
            if (options.method === 'PUT') {
                writes.push(url);
                if (url === '/api/ide-hierarchy') {
                    if (nodeFails) return {ok:false,json:async()=>({error:'save refused'})};
                    config = {...config, node:mismatchedReadback ? 'anotherNode' : JSON.parse(options.body).node};
                }
            }
            return {ok:true,json:async()=>url === '/api/ide-hierarchy' ? config :
                {ok:true,document:{rows:[]},fingerprint:'new',projection:{}}};
        }
    };
    vm.createContext(scope);
    for (const file of ['namespace-ide-node.js','namespace-design-v1.js'])
        vm.runInContext(fs.readFileSync(__dirname + '/' + file,'utf8'),scope);
    await new Promise(resolve=>setImmediate(resolve));
    const design = scope.window.NamespaceDesignV1;
    design.state.document = {rows:[]};
    design.state.fingerprint = 'old';
    if (stale) config = {...config,node:'ide1'};
    const desired = stale ? 'ide' : 'ide1';
    elements.namespaceIdeNodeInput.value = desired;
    elements.namespaceIdeNodeInput.events.input();
    await design.save();
    assert.equal(design.state.saving,false);
    if (!confirmed) {
        assert.deepEqual(writes,[]);
        assert.match(design.state.error,/save stopped/);
    } else if (nodeFails || mismatchedReadback) {
        assert.deepEqual(writes,['/api/ide-hierarchy']);
        assert.match(design.state.error,/save stopped/);
    } else {
        assert.deepEqual(writes,['/api/ide-hierarchy','/api/namespace/design-v1']);
        assert.equal(config.node,desired);
        assert.equal(scope.window.NamespaceIdeNode.hasPending(),false);
        await elements.namespaceIdeNodeReload.events.click();
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(elements.namespaceIdeNodeInput.value,desired);
    }
}
(async()=>{
    await run(true);
    await run(false);
    await run(true,true);
    await run(true,false,true);
    await run(true,false,false,true);
    const memory = fs.readFileSync(__dirname+'/app-memory.js','utf8');
    const clickHandler = memory.slice(memory.indexOf('async function _nsTableSaveClick('),
        memory.indexOf('// Update the Save NS button'));
    let nodeAllowed=false, tableWrites=0;
    const legacy = {window:{
        NamespaceIdeNode:{savePending:async()=>nodeAllowed},
        _nsTableSaveCancelled:false, _nsTableSaveError:null,
        _nsTableSave:async()=>{tableWrites++;return true;}
    },_setNsDirty(){}};
    vm.createContext(legacy);
    vm.runInContext(clickHandler,legacy);
    assert.equal(await legacy._nsTableSaveClick({}),false);
    assert.equal(tableWrites,0);
    nodeAllowed=true;
    assert.equal(await legacy._nsTableSaveClick({}),true);
    assert.equal(tableWrites,1);
    console.log('PASS Namespace Design Save includes node; cancellation/failure blocks table save; reload retains node');
})().catch(e=>{console.error(e);process.exitCode=1;});
