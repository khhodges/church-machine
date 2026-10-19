// Explicit, admitted ascending replay. Never uses the historical image loader,
// replaces its machine, installs candidate files, or sends hardware commands.
(function(root) {
    'use strict';
    let machine = null, provenance = null, frozenWords = null, owner = null;
    let busy = false, running = false, generation = 0, runEpoch = 0, steps = 0;
    let message = 'Save a LUMP or prepare this saved design for private simulation. Hardware and installed images stay unchanged.';
    const esc = value => String(value).replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function selection() {
        const state = root.NamespaceDesignV1 && root.NamespaceDesignV1.state;
        if (!state || !state.active || state.dirty || !state.document || !state.fingerprint)
            throw Error('Save the selected Namespace design before private simulation.');
        return {profile:state.profile, fingerprint:state.fingerprint, document:JSON.stringify(state.document)};
    }
    function same(selected) {
        try { return JSON.stringify(selection()) === JSON.stringify(selected); }
        catch (_) { return false; }
    }
    function markup() {
        const ready = machine && owner && same(owner);
        return '<strong>Selected design · private simulator</strong> ' +
            '<button class="btn btn-sm" onclick="DesignSimulation.prepare()" title="Validate, approve and load this exact saved design for private simulation"' + (busy?' disabled':'') + '>Prepare fresh simulation</button> ' +
            ['Step','Run','Stop','Reset'].map(action =>
                '<button class="btn btn-sm" onclick="DesignSimulation.'+action.toLowerCase()+'()"' +
                (busy || !ready || (running && action!=='Stop') ? ' disabled' : '') + '>'+action+'</button>').join(' ') +
            '<p role="status" style="white-space:pre-wrap">'+esc(message)+'</p>'+
            (provenance && !ready ? '<p role="alert">The selected design has changed. These retained bytes are not current; prepare the selected design again before execution.</p>' : '')+
            (provenance ? '<details><summary>Exact simulation identity</summary><pre style="white-space:pre-wrap">'+
                esc(JSON.stringify({profile:provenance.designProfile, imageHash:provenance.imageHash,
                    configurationHash:provenance.configurationHash, approvedRevisionId:provenance.approvedRevisionId,
                    artifactBindings:provenance.artifactBindings},null,2))+'</pre></details>':'')+
            (machine ? '<pre style="white-space:pre-wrap">'+esc('Instructions: '+steps+
                ' · NIA: '+machine.pc+' · DR1: '+(machine.dr[1]>>>0)+
                (machine.halted?' · stopped':'')+'\n'+(machine.output || '').slice(-4000)+
                '\n'+(machine.faultLog || []).map(f=>f.message || f.type).join('\n'))+'</pre>':'')+
            '<small>These controls run the verified ascending runtime only. Legacy Run remains separate and blocked after a save. No hardware certification or installation.</small>';
    }
    function render() {
        if (typeof document === 'undefined') return;
        const host = document.getElementById('designSimulationPanel');
        if (host) host.innerHTML = markup();
    }
    function stop() { runEpoch++; running=false; render(); }
    function invalidate() {
        generation++; runEpoch++; running=false; machine=null; provenance=null; frozenWords=null; owner=null;
        message='Saved revision changed. Prepare a fresh private simulation; previous execution is stopped.';
        render();
    }
    async function request(selected, action, payload) {
        const response = await fetch('/api/simulation/design/'+selected.profile+'/'+action, {
            method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'NamespaceDesign'},
            body:JSON.stringify(payload)});
        const data = await response.json();
        if (!response.ok || data.ok===false) throw Error([data.error,data.nextAction].filter(Boolean).join(' ') || 'Private simulation request failed.');
        return data;
    }
    function create(words, record) {
        const instance = ChurchSimulator.fromAscendingNamespaceImage(new Uint32Array(words), {
            word0:0x02000001, word1:0, word2:record.slotCount*4-1, word3:0, m:1});
        if (!instance.startEntryThread() || instance.halted)
            throw Error('The admitted entry Thread could not start: '+(instance.faultLog || []).map(f=>f.message).join('; '));
        return instance;
    }
    async function prepare(throwOnError=false) {
        if (busy) {
            if (throwOnError) throw Error('Private simulation preparation is already in progress; retry after it finishes.');
            return false;
        }
        invalidate();
        busy=true;
        const ticket=generation;
        try {
            const selected=selection();
            const check=()=>{if(ticket!==generation || !same(selected)) throw Error('Namespace selection changed during preparation. Retry the selected design.');};
            message='Validating exact saved identities and preparing private simulation…'; render();
            const review=await request(selected,'prepare',{namespaceFingerprint:selected.fingerprint});
            check();
            if (review.imageFormat!=='ascending-nst-metadata-slot0-v1' ||
                review.designProfile!==selected.profile || review.sourceNamespaceFingerprint!==selected.fingerprint ||
                review.hardwareCertified!==false || !review.configurationHash || !review.imageHash ||
                !Number.isInteger(review.slotCount) || !Array.isArray(review.artifactBindings))
                throw Error('Preparation did not provide exact ascending simulation provenance.');
            const body={preparationId:review.preparationId,configurationHash:review.configurationHash};
            const approved=await request(selected,'approve',body);
            check();
            if(approved.approved!==true || approved.configurationHash!==review.configurationHash ||
               approved.imageHash!==review.imageHash || !approved.approvedRevisionId)
                throw Error('Approval did not match the exact reviewed simulation.');
            const active=await request(selected,'activate',body);
            check();
            if(active.activated!==true || active.configurationHash!==review.configurationHash ||
               active.imageHash!==review.imageHash || active.designProfile!==selected.profile ||
               active.hardwareCertified!==false || !Array.isArray(active.words) ||
               !active.words.length || !active.words.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff))
                throw Error('Activation did not return the exact admitted private image.');
            const bytes=new ArrayBuffer(active.words.length*4), view=new DataView(bytes);
            active.words.forEach((word,index)=>view.setUint32(index*4,word,true));
            const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
                b=>b.toString(16).padStart(2,'0')).join('');
            check();
            if(hash!==review.imageHash) throw Error('Private simulation bytes failed the approved image hash.');
            const candidate=create(active.words,review);
            check();
            machine=candidate; frozenWords=active.words.slice(); owner=selected;
            provenance={...review,approvedRevisionId:approved.approvedRevisionId}; steps=0;
            message='Fresh selected design loaded and verified. Use Step or Run here. Historical artifacts, installed image and hardware are unchanged.';
            return true;
        } catch(error) {
            message='Private simulation blocked: '+error.message;
            if(throwOnError) throw error;
            return false;
        } finally { busy=false; render(); }
    }
    function ready() {
        if(busy || !machine || !same(owner)) {
            stop(); message='The selected design differs from this private simulation. Prepare it again.'; render(); return false;
        }
        return true;
    }
    function execute(count) {
        if(!ready()) return false;
        try {
            for(let i=0;i<count && !machine.halted;i++) {machine.step();steps++;}
            message=machine.halted ? 'Private simulation stopped. Inspect its output/fault below; Reset reuses the same verified bytes.' : 'Executing the exact approved private simulation.';
        } catch(error) {running=false;machine.halted=true;message='Private simulation stopped: '+error.message;}
        render();
        return !machine.halted;
    }
    function run() {
        if(running || !ready()) return;
        running=true;
        const ticket=generation, epoch=++runEpoch;
        const batch=()=>{
            if(!running || ticket!==generation || epoch!==runEpoch) return;
            if(execute(250) && running) setTimeout(batch,0);
            else {running=false;render();}
        };
        batch();
    }
    function reset() {
        if(!ready()) return;
        stop();
        try { machine=create(frozenWords,provenance);steps=0;message='Reset to the same verified image and entry Thread.'; }
        catch(error) {machine=null;message='Private reset blocked: '+error.message;}
        render();
    }
    root.DesignSimulation={prepare,stop,invalidate,markup,render,run,reset,
        step:()=>{if(!running) execute(1);}};
})(typeof window!=='undefined'?window:globalThis);
