'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');

(async () => {
    const html=fs.readFileSync(__dirname+'/index.html','utf8');
    const source=fs.readFileSync(__dirname+'/namespace-design-v1.js','utf8');
    const start=html.indexOf('<div class="nr-picker">');
    const end=html.indexOf('<div id="namespaceHeaderStatus"',start);
    const dom=new JSDOM(html.slice(start,end),{runScripts:'outside-only'});
    const w=dom.window;
    w.root=w;
    w.state={loading:false,saving:false};
    w.copies=[{id:'user-b',name:'Cooperative Retry — USER B — Review'}];
    w.key='namespace:legacy';
    w.selectionKey=()=>w.key;
    w.esc=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    const selected=[];
    let reject=false;
    w.NamespaceDesignV1={selectShared:async key=>{
        if(reject) throw Error('Save the current Namespace before switching. Your draft is retained.');
        selected.push(key);w.key=key;
    }};
    w.eval(source.slice(source.indexOf('    function syncNamespacePicker()'),
        source.indexOf('    function render()')));
    w.syncNamespacePicker();
    const menu=w.document.getElementById('namespacePickerMenu');
    const choices=w.document.getElementById('namespacePickerChoices');
    const name=w.document.getElementById('namespacePickerName');
    const selector=w.document.getElementById('namespaceDesignProfile');
    assert(selector.hidden,'native popup is not the visible control');
    menu.querySelector('summary').click();
    assert(menu.open,'summary opens the inline choices');
    const originalButton=choices.firstElementChild;
    for(let i=0;i<100;i++)w.syncNamespacePicker();
    assert(menu.open,'periodic refresh does not close the menu');
    assert.equal(choices.firstElementChild,originalButton,'refresh preserves focused button');
    for(const [value,label] of [['ascending','New Layout'],['copy:user-b',w.copies[0].name],['legacy','Original']]){
        menu.open=true;
        await choices.onclick({target:choices.querySelector(`[data-namespace-value="${value}"]`)});
        assert.equal(selected.at(-1),'namespace:'+value);
        assert.equal(name.textContent,label);
        assert.equal(selector.value,value);
        assert(!menu.open);
    }
    reject=true;menu.open=true;
    await choices.onclick({target:choices.querySelector('[data-namespace-value="ascending"]')});
    assert(menu.open,'rejected transition keeps choices visible');
    assert.equal(name.textContent,'Original','draft guard preserves selection');
    const error=w.document.getElementById('namespacePickerError');
    assert(!error.hidden);
    assert.match(error.textContent,/draft is retained/);
    menu.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert(!menu.open);
    assert.equal(w.document.activeElement,menu.querySelector('summary'));
    w.state.saving=true;w.syncNamespacePicker();
    assert([...choices.querySelectorAll('button')].every(b=>b.disabled));
    dom.window.close();
    console.log('PASS inline Namespace menu: open, refresh, choose built-ins/copies, draft rejection, Escape, busy state');
})().catch(error=>{console.error(error);process.exitCode=1;});
