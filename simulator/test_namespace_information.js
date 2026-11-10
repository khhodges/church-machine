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
let requests=0, fail=false;
const scope = {document:{getElementById:id=>id==='namespaceInfoDialog'?modal:content},
    root:{renderMarkdown:text=>'<article>'+text+'</article>'},
    fetch:async (url,options)=>{
        requests++;
        assert.equal(url,'/docs/namespace-as-an-application.md');
        assert.equal(options.method,undefined,'Information must only read');
        return {ok:!fail,status:503,text:async()=>doc};
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
    assert(html.includes('onclick="NamespaceDesignV1.showInformation()"'));
    assert(html.includes('aria-label="About the Namespace as an application"'));
    assert(html.includes('<form method="dialog">'));
    assert.match(doc,/running application/);
    console.log('PASS Namespace information: Markdown source, read-only request, modal handling and actionable failure');
})().catch(error=>{console.error(error);process.exitCode=1;});
