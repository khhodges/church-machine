'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname+'/namespace-design-v1.js','utf8');
const html = fs.readFileSync(__dirname+'/index.html','utf8');
const doc = fs.readFileSync(__dirname+'/../docs/namespace-as-an-application.md','utf8');
const content = {textContent:'', innerHTML:''};
const modal = {open:false, dataset:{}, handlers:{},
    showModal(){this.open=true;}, addEventListener(name,fn){this.handlers[name]=fn;}};
const selector = {selectedOptions:[{textContent:'Cooperative Retry — USER B — Review'}]};
const link = {removeAttribute(name){delete this[name];}};
const title = {};
const elements = {namespaceInfoDialog:modal, namespaceInfoContent:content,
    namespaceDesignProfile:selector, namespaceInfoDocument:link, namespaceInfoTitle:title};
let requests=0, fail=false, expectedFile='namespace-as-an-application.md';
const scope = {document:{getElementById:id=>elements[id]},
    root:{renderMarkdown:text=>'<article>'+text+'</article>'},
    fetch:async (url,options)=>{
        requests++;
        assert.equal(url,'/docs/'+expectedFile);
        assert.equal(options.method,undefined,'Information must only read');
        return {ok:!fail,status:503,text:async()=>fs.readFileSync(__dirname+'/../docs/'+expectedFile,'utf8')};
    }};
vm.createContext(scope);
vm.runInContext(source.slice(source.indexOf('    async function showInformation('),
    source.indexOf('    function identity(')),scope);
(async()=>{
    await scope.showInformation();
    assert(modal.open);
    assert(content.innerHTML.includes(doc),'Popup must render the actual Markdown');
    await scope.showInformation();
    assert.equal(requests,1,'Repeated click must not reopen an open modal');
    let stopped=false;
    modal.handlers.keydown({stopPropagation(){stopped=true;}});
    assert(stopped,'Popup keyboard events must not reach editor shortcuts');
    modal.open=false; fail=true;
    await scope.showInformation();
    assert.match(content.textContent,/HTTP 503/);
    assert.match(content.textContent,/No design data was changed/);
    assert.match(content.textContent,/retry/);
    fail=false;
    for (const [name,file,phrase] of [
        ['Cooperative Retry — USER B — Review','namespace-application-cooperative-user-b.md','USER B making progress'],
        ['Cooperative Retry — All Waiting — Review','namespace-application-cooperative-all-waiting.md','no second USER progress counter']
    ]) {
        modal.open=false;
        selector.selectedOptions[0].textContent=name;
        expectedFile=file;
        await scope.showInformation(true);
        assert.equal(title.textContent,name);
        assert.equal(link.href,'/docs/'+file);
        assert.equal(link.hidden,false);
        assert(content.innerHTML.includes(phrase));
        assert.equal(modal.dataset.trigger,'namespaceApplicationInfoButton');
    }
    modal.open=false;
    selector.selectedOptions[0].textContent='Original';
    const before=requests;
    await scope.showInformation(true);
    assert.equal(requests,before,'Unknown applications must not fetch another application guide');
    assert.match(content.textContent,/has not been written for Original/);
    assert.equal(link.hidden,true);
    modal.open=false; expectedFile='namespace-as-an-application.md';
    await scope.showInformation();
    assert.equal(link.hidden,false);
    assert.equal(title.textContent,'The Namespace as an application');
    assert.equal(modal.dataset.trigger,'namespaceInfoButton');
    assert(html.includes('onclick="NamespaceDesignV1.showInformation()"'));
    assert(html.includes('aria-label="About the Namespace as an application"'));
    assert(html.includes('onclick="NamespaceDesignV1.showInformation(true)"'));
    assert(html.includes('<form method="dialog">'));
    assert.match(doc,/running application/);
    console.log('PASS Namespace information: Markdown source, read-only request, modal handling and actionable failure');
})().catch(error=>{console.error(error);process.exitCode=1;});
