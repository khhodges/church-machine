'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');

(async () => {
    const dom = new JSDOM('<select id="namespaceDesignProfile"></select>', {
        url:'https://namespace.test/', runScripts:'outside-only',
    });
    const w=dom.window;
    w.localStorage.setItem('church_namespace_design_profile','legacy');
    const calls=[];
    w.fetch=async url=>{
        calls.push(url);
        assert.equal(url,'/api/namespace/design-copies', 'Original only reads the catalog');
        return {ok:true,json:async()=>({ok:true,copies:[
            {id:'user-b',name:'Cooperative Retry — USER B — Review'},
            {id:'waiting',name:'Cooperative Retry — All Waiting — Review'},
        ]})};
    };
    w.alert=message=>{throw Error(message);};
    w.eval(fs.readFileSync('simulator/namespace-design-v1.js','utf8'));
    await new Promise(resolve=>setTimeout(resolve,20));
    const picker=w.document.getElementById('namespaceDesignProfile');
    assert.equal(picker.value,'legacy');
    assert.equal(picker.options.length,5);
    assert.equal(picker.options[3].value,'copy:user-b');
    assert.match(picker.options[4].textContent,/All Waiting/);
    assert.equal(calls.length,1);
    assert.equal(w.NamespaceDesignV1.state.active,false);
    for(let i=0;i<10;i++) w.NamespaceDesignV1.render();
    assert.equal(calls.length,1);
    assert.equal(picker.options.length,5);
    dom.window.close();
    console.log('PASS Original startup includes saved examples without loading or changing a design');
})().catch(error=>{console.error(error);process.exitCode=1;});
