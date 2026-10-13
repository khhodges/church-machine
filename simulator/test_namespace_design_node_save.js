'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
async function run(confirmed, nodeFails = false) {
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
                    config = {...config, node:JSON.parse(options.body).node};
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
    elements.namespaceIdeNodeInput.value = 'ide1';
    elements.namespaceIdeNodeInput.events.input();
    await design.save();
    assert.equal(design.state.saving,false);
    if (!confirmed) {
        assert.deepEqual(writes,[]);
        assert.match(design.state.error,/save stopped/);
    } else if (nodeFails) {
        assert.deepEqual(writes,['/api/ide-hierarchy']);
        assert.match(design.state.error,/save stopped/);
    } else {
        assert.deepEqual(writes,['/api/ide-hierarchy','/api/namespace/design-v1']);
        assert.equal(config.node,'ide1');
        assert.equal(scope.window.NamespaceIdeNode.hasPending(),false);
        await elements.namespaceIdeNodeReload.events.click();
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(elements.namespaceIdeNodeInput.value,'ide1');
    }
}
(async()=>{
    await run(true);
    await run(false);
    await run(true,true);
    console.log('PASS Namespace Design Save includes node; cancellation/failure blocks table save; reload retains node');
})().catch(e=>{console.error(e);process.exitCode=1;});
