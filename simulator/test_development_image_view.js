'use strict';
// Development Image is an IDE view: shared shell header, hash route with exact
// selection, menu action, no separate tab, and no iframe redirect loop.
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const dir=__dirname, html=fs.readFileSync(dir+'/index.html','utf8');
const tag=f=>crypto.createHash('sha256').update(fs.readFileSync(dir+'/'+f)).digest('hex').slice(0,12);
for(const f of ['development-image-view.js','namespace-design-v1.js','app-shell.js'])
    assert(html.includes(f+'?v=sha256-'+tag(f)),f+' cache key matches served bytes');
assert(html.indexOf('development-image-view.js')>html.indexOf('app-shell.js')&&html.indexOf('development-image-view.js')<html.indexOf('namespace-design-v1.js'));
const view=html.slice(html.indexOf('<div id="development-image" class="view">'));
assert(/^<div id="development-image" class="view">\s*<div class="panel">\s*<div class="panel-title">Development Image<\/div>\s*<iframe id="developmentImageFrame"/.test(view),'same panel title format as Namespace');
assert(html.includes(`id="hamItem-development-image" onclick="switchView('development-image');closeHamburger()"`),'menu action in shell');
assert(html.includes(`id="hamItem-memory-glass" onclick="DevelopmentImageView.show();closeHamburger()">Memory Map (Glass)</button>`),'Memory Glass menu preserves the selected Namespace through the shared view');
const shell=fs.readFileSync(dir+'/app-shell.js','utf8');
assert.equal(shell.split("'namespace-dna','development-image']").length-1,2,'hash route and default-view lists include the view');
const ns=fs.readFileSync(dir+'/namespace-design-v1.js','utf8');
assert(!ns.includes("'_blank'")&&ns.includes('DevelopmentImageView.openFromNamespace'),'Namespace opens the IDE view, not a new tab');
const app=fs.readFileSync(dir+'/../artifacts/development-image/src/DevelopmentImage.tsx','utf8');
assert(!app.includes('IdeMenu')&&!app.includes('CHURCH MACHINE'),'embedded app does not copy the IDE header');
for(const s of ['prepareExact(','installExact(','/api/development-image/prepare','Replace runtime memory and send']) assert(app.includes(s),'send logic preserved: '+s);

// Execute the shell script against a minimal DOM.
function run(hash){
    const listeners={}, frame={attrs:{},style:{},contentWindow:{},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]??null;}};
    const viewEl={id:'development-image',classList:{c:new Set(),contains(x){return this.c.has(x);}}};
    const calls=[];
    const win={location:{hash,pathname:'/simulator/',search:'',origin:'https://ide.test',href:'https://ide.test/simulator/'+hash},
        history:{replaceState(_a,_b,url){win.location.hash=url.slice(url.indexOf('#'));}},
        addEventListener(t,f){listeners[t]=f;}, alert(m){calls.push(['alert',m]);},
        switchView(id){calls.push(['switch',id]);win.location.hash='#'+id;viewEl.classList.c[id==='development-image'?'add':'delete']('active');}};
    const document={getElementById:id=>id==='developmentImageFrame'?frame:id==='development-image'?viewEl:null,querySelectorAll:()=>[viewEl,{id:'namespace'}]};
    vm.runInNewContext(fs.readFileSync(dir+'/development-image-view.js','utf8'),{window:win,document,URL,URLSearchParams,fetch:async()=>({ok:true,url:'https://ide.test/development-image/?namespace=design%3Aabc'})});
    return {win,frame,calls,listeners,viewEl};
}
(async()=>{
    // Linked selection survives the shell rewriting the hash to the bare view id.
    let t=run('#development-image?namespace=design%3A111');
    t.win.switchView('development-image');
    assert.equal(t.frame.attrs.src,'/development-image/?namespace=design%3A111');
    assert.equal(t.win.location.hash,'#development-image?namespace=design%3A111');
    // Selection change inside the app updates the route without reloading the frame.
    t.listeners.message({origin:'https://ide.test',source:t.frame.contentWindow,data:{type:'development-image:selection',namespace:'design:222'}});
    assert.equal(t.win.location.hash,'#development-image?namespace=design%3A222');
    assert.equal(t.frame.attrs.src,'/development-image/?namespace=design%3A111');
    // Foreign messages are ignored.
    t.listeners.message({origin:'https://evil.test',source:t.frame.contentWindow,data:{type:'development-image:selection',namespace:'x'}});
    assert.equal(t.win.DevelopmentImageView.selection(),'design:222');
    // Back navigation to another view leaves Development Image; forward restores selection.
    t.win.location.hash='#namespace'; t.listeners.hashchange();
    assert.deepEqual(t.calls.at(-1),['switch','namespace']);
    t.win.location.hash='#development-image?namespace=design%3A333'; t.listeners.hashchange();
    assert.equal(t.frame.attrs.src,'/development-image/?namespace=design%3A333');
    // Namespace action resolves the exact saved identity and switches view in place.
    t=run('#namespace');
    await t.win.DevelopmentImageView.openFromNamespace('profile=ascending&fingerprint=f');
    assert.deepEqual(t.calls.at(-1),['switch','development-image']);
    assert.equal(t.frame.attrs.src,'/development-image/?namespace=design%3Aabc');
    console.log('PASS Development Image IDE view routing, selection and header integration');
})().catch(e=>{console.error(e);process.exit(1);});
