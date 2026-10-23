'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const controls={input:{value:''},form:{},'[type=submit]':{},
    '#namespaceDuplicateError':{},'#namespaceDuplicateCancel':{}};
const dialog={style:{},querySelector:key=>controls[key],addEventListener(){},
    showModal(){},close(){},remove(){}};
controls.input.focus=()=>{};
const requests=[];
const scope={
    document:{readyState:'loading',addEventListener(){},getElementById(){return null;},
        createElement:()=>dialog,body:{appendChild(){}}},
    localStorage:{getItem(){return null;},setItem(){}},
    NamespaceProfileNames:{label:p=>p},
    updateNamespace(){},
    fetch:async(url,options={})=>{
        requests.push({url,options});
        if(url==='/api/namespace/design-copies' && options.method!=='POST')
            return {ok:true,json:async()=>({ok:true,copies:[
                {id:'a'.repeat(32),name:'Existing',profile:'phase1'}]})};
        if(options.method==='POST')
            return {ok:false,json:async()=>({error:'Source Namespace changed; reload it'})};
        return {ok:true,json:async()=>({ok:true,persisted:true,fingerprint:'frozen',
            document:{rows:[],slotCount:256},projection:{rows:[]}})};
    }
};
scope.window=scope;
vm.runInNewContext(fs.readFileSync(__dirname+'/namespace-design-v1.js','utf8'),scope);
(async()=>{
    const api=scope.NamespaceDesignV1;
    api.state.profile='phase1';
    await api.load();
    api.duplicateNamespace();
    for(const name of ['Original','existing','  ']){
        controls.input.value=name;
        const before=requests.length;
        await controls.form.onsubmit({preventDefault(){}});
        assert.equal(requests.length,before,'invalid names never reach approval/network');
        assert.ok(controls['#namespaceDuplicateError'].textContent);
    }
    controls.input.value='New design';
    await controls.form.onsubmit({preventDefault(){}});
    const post=requests.at(-1);
    assert.equal(post.options.method,'POST');
    assert.deepEqual(JSON.parse(post.options.body),
        {profile:'phase1',sourceId:'',fingerprint:'frozen',name:'New design'});
    assert.match(controls['#namespaceDuplicateError'].textContent,/Source Namespace changed/);
    assert.equal(api.state.saving,false);
    await api.selectCopy('a'.repeat(32));
    assert.match(requests.at(-1).url,/profile=phase1&design=a{32}/);
    api.state.dirty=true;
    await api.selectCopy('');
    assert.equal(api.state.designId,'a'.repeat(32));
    assert.match(api.state.error,/draft is retained/);
    console.log('PASS duplicate name validation, frozen source, copy routing and draft guard');
})().catch(error=>{console.error(error);process.exitCode=1;});
