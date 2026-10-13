/* The ascending profile of the Namespace editor. Drafts never write sim or ns-state. */
(function(root) {
    'use strict';
    const clone = value => JSON.parse(JSON.stringify(value));
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g,
        c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const hex = n => n == null ? 'Unresolved' : '0x' + n.toString(16).toUpperCase().padStart(8,'0');
    const state = {active:true, loading:false, saving:false, document:null, fingerprint:null,
        projection:null, error:'', dirty:false};
    const endpoint = '/api/namespace/design-v1';
    async function request(method, body) {
        const response = await fetch(endpoint, {method, cache:'no-store',
            headers:{'Content-Type':'application/json','X-Requested-With':'NamespaceDesign'},
            ...(body ? {body:JSON.stringify(body)} : {})});
        const data = await response.json();
        if (!response.ok || !data.ok) throw Error(data.error || 'Namespace design request failed');
        return data;
    }
    function accept(data) {
        state.document = clone(data.document);
        state.fingerprint = data.fingerprint;
        state.projection = data.projection;
        state.dirty = false;
        state.error = '';
    }
    async function load() {
        if (state.loading) return;
        state.loading = true;
        try { accept(await request('GET')); }
        catch (e) { state.error = e.message; }
        finally { state.loading = false; render(); }
    }
    function setProfile(value) {
        state.active = value === 'ascending';
        const legacy = document.getElementById('bootCapacityPanel');
        if (legacy) legacy.hidden = state.active;
        root.updateNamespace();
    }
    function changed() { state.dirty=true; state.error=''; render(); }
    function render() {
        if (!state.active) return;
        const host = document.getElementById('namespaceTable');
        if (!host) return;
        const capacity = document.getElementById('bootCapacityPanel');
        if (capacity) capacity.hidden = true;
        if (!state.document) {
            host.innerHTML = state.error ? `<p role="alert">${esc(state.error)}</p><button onclick="NamespaceDesignV1.load()">Retry</button>` :
                '<p>Loading new-format Namespace design…</p>';
            if (!state.loading && !state.error) load();
            return;
        }
        const d = state.document, p = state.projection;
        const header = [0xf8810100, 0, d.rows.length-1, 0];
        const busy = state.saving ? 'disabled' : '';
        let text = `<div class="ns-layout-header">Ascending Namespace · 64 slots · 4 words per entry · API-only build profile · CR15 table limit 255 words</div>
            <div style="display:flex;gap:10px;align-items:center;padding:10px 0;flex-wrap:wrap">
            <button id="nsSaveBtn" class="btn" ${busy} onclick="NamespaceDesignV1.save()">Save Namespace Table${state.dirty?' *':''}</button>
            <button id="nsAddButton" class="btn" ${busy} onclick="NamespaceDesignV1.edit()">+ Add to Namespace</button>
            <span role="status">${state.saving?'Saving…':state.dirty?'Unsaved design changes':'New-format design — not installed'}</span></div>
            <p id="nsSaveLayoutNote" role="${state.error?'alert':'status'}">${esc(state.error || 'Slot 0 is the header, slot 1 is Namespace self, slot 2 is the entry Thread. Save changes this design only; no image is built or activated.')}</p>
            <div style="overflow-x:auto"><table class="ns-table"><thead><tr><th>Slot</th><th>Entry word address</th><th>Name / object</th><th>Policy</th><th>Proposed base</th><th>API allocation</th><th>Generation</th><th>Actions</th></tr></thead><tbody>
            <tr id="ns-row-0"><td>0</td><td>${hex(0)}</td><td colspan="5"><strong>Metadata / physical header</strong><br>
            ${header.map((w,i)=>`W${i} ${hex(w)}`).join(' · ')}<br>W0 Namespace header · W1 base · W2 members excluding self · W3 reserved</td>
            <td><button class="btn" onclick="NamespaceDesignV1.inspect(0)">Inspect</button></td></tr>`;
        const max = Math.min(63, Math.max(14,...d.rows.map(r=>r.slot))+1);
        for (let slot=1; slot<=max; slot++) {
            const row=d.rows.find(r=>r.slot===slot);
            if (!row) {
                text+=`<tr id="ns-row-${slot}"><td>${slot}</td><td>${hex(slot*4)}</td><td colspan="5">Empty</td><td><button class="btn" ${busy} onclick="NamespaceDesignV1.edit(null,${slot})">ADD</button></td></tr>`;
                continue;
            }
            const projected = !state.dirty && p.rows.find(r=>r.slot===slot);
            const address = row.kind==='namespace'?0:row.kind==='mmio'?row.address:projected?projected.location:null;
            const allocation = row.kind==='namespace'?'256 table words':row.kind==='mmio'?`MMIO · limit ${row.limit}`:
                row.kind==='thread'?`${row.words} words`:row.policy==='Lazy'?'Unallocated / Lazy':
                projected && projected.allocationWords?`${projected.allocationWords} words`:'Recalculate on Save';
            text+=`<tr id="ns-row-${slot}" data-ns-slot="${slot}"><td>${slot}</td><td>${hex(slot*4)}</td>
                <td><button class="btn" onclick="NamespaceDesignV1.source(${slot})">${esc(row.name)}</button>${row.boot?' · Boot target':''}</td>
                <td>${esc(row.policy)}</td><td>${hex(address)}${row.kind==='mmio'?' (device byte address)':' (word)'}</td>
                <td>${allocation}</td><td>${row.sequence}</td><td>
                <button class="btn" onclick="NamespaceDesignV1.inspect(${slot})">Inspect</button>
                ${row.kind==='lump'?`<button class="btn" ${busy} onclick="NamespaceDesignV1.edit(${slot})">Edit</button>
                ${!row.boot?`<button class="btn" ${busy} onclick="NamespaceDesignV1.clear(${slot})">Clear</button>`:''}`:''}</td></tr>`;
        }
        text+='</tbody></table></div>';
        if (!state.dirty) {
            text+=`<p>Proposed RAM footprint: ${p.usedWords==null?'unresolved':`${p.usedWords} words / ${p.usedWords*4} bytes`}. Executable allocations use API-only sizing, not source-bearing file sizes.</p>`;
            if (p.warnings.length) text+=`<details open><summary>Build validation still required</summary><ul>${p.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details>`;
        }
        host.innerHTML=text;
    }
    function dialog(title, content) {
        const old=document.getElementById('namespaceDesignDialog');
        if(old) old.remove();
        const overlay=document.createElement('div');
        overlay.id='namespaceDesignDialog';
        overlay.style.cssText='position:fixed;inset:0;background:#000b;z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px';
        overlay.innerHTML=`<section role="dialog" aria-modal="true" aria-label="${esc(title)}" style="background:#12121f;color:#ddd;padding:24px;max-width:620px;width:100%;max-height:85vh;overflow:auto;border:1px solid #777;border-radius:6px"><h3>${esc(title)}</h3>${content}<button class="btn" id="nsDraftClose">Close</button></section>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#nsDraftClose').onclick=()=>overlay.remove();
        return overlay;
    }
    function inspect(slot) {
        const row = slot===0 ? {slot:0, entryWord:0,
            metadataWords:[0xf8810100,0,state.document.rows.length-1,0], executable:false} :
            {...state.document.rows.find(r=>r.slot===slot), entryWord:slot*4,
                ...(!state.dirty ? {proposedDescriptor:state.projection.rows.find(r=>r.slot===slot)} : {})};
        dialog(`Namespace slot ${slot} — design inspection`,
            `<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(row,null,2))}</pre><p>Design evidence only; not runtime memory or executable approval.</p>`);
    }
    function source(slot) {
        const row=state.document.rows.find(r=>r.slot===slot);
        if (row.kind!=='lump') return inspect(slot);
        root._nsOpenDesignSelection({name:row.name, selection:row.selection || {status:'missing'}},slot);
    }
    function clear(slot) {
        if(state.saving) return;
        const row=state.document.rows.find(r=>r.slot===slot);
        if(!row || row.kind!=='lump' || row.boot) return;
        if(!root.confirm(`Remove ${row.name} from this design? Its saved LUMP and installed image will not be deleted.`)) return;
        state.document.rows=state.document.rows.filter(r=>r.slot!==slot);
        changed();
    }
    async function edit(slot, preferred) {
        if(state.saving) return;
        const original=state.document.rows.find(r=>r.slot===slot);
        if(original && original.kind!=='lump') return;
        const free=Array.from({length:61},(_,i)=>i+3).find(s=>!state.document.rows.some(r=>r.slot===s));
        const overlay=dialog(original?'Edit Namespace member':'Add LUMP to Namespace',
            `<label>Saved LUMP (optional)<select id="nsDraftLump" style="width:100%"><option value="">Unfinished / name only</option></select></label>
            <p><label>Pet name <input id="nsDraftName" maxlength="128" value="${esc(original?original.name:'')}" style="width:100%"></label></p>
            <p><label>Slot <input id="nsDraftSlot" type="number" min="3" max="63" value="${original?original.slot:preferred||free||''}"></label></p>
            <p><label>Policy <select id="nsDraftPolicy"><option>Lazy</option><option>Resident</option></select></label></p>
            <p><label><input id="nsDraftBoot" type="checkbox" ${original&&original.boot?'checked':''}> Boot target in this design</label></p>
            <p>Unfinished entries are allowed. Placement does not grant execution authority.</p>
            <p id="nsDraftError" role="alert"></p><button class="btn" id="nsDraftApply">${original?'Apply changes':'Add to Namespace (design)'}</button> `);
        const name=overlay.querySelector('#nsDraftName'), slotEl=overlay.querySelector('#nsDraftSlot');
        const policy=overlay.querySelector('#nsDraftPolicy'), picker=overlay.querySelector('#nsDraftLump');
        policy.value=original?original.policy:'Lazy';
        let selected=original && original.selection;
        let records=[];
        picker.onchange=()=>{
            const record=records[Number(picker.value)];
            selected=picker.value===''?null:record ? {
                filename:record.filename, binaryHash:record.binary_hash || record.binaryHash,
                token:record.token, revision:record.lump_version || record.revision,
            }:null;
            if(record && picker.value!=='') name.value=record.abstraction || record.name || '';
        };
        overlay.querySelector('#nsDraftApply').onclick=()=>{
            const value=name.value.trim(), next=Number(slotEl.value);
            const error=overlay.querySelector('#nsDraftError');
            if(!value || /[\x00-\x1f\x7f]/.test(value) || !Number.isInteger(next) || next<3 || next>=64 ||
                state.document.rows.some(r=>r!==original && (r.slot===next || r.name===value))) {
                error.textContent='Choose a unique pet name and a free slot from 3 to 63.'; return;
            }
            if(original && next!==original.slot) {
                error.textContent='Clear and add a separate design placement to change its slot; existing bindings are not rewritten.'; return;
            }
            const row={slot:next,name:value,kind:'lump',policy:policy.value,sequence:original?original.sequence:0};
            if(selected) row.selection=clone(selected);
            const boot=overlay.querySelector('#nsDraftBoot').checked;
            if(original && original.boot && !boot) {
                error.textContent='Select another member as boot target first.'; return;
            }
            if(boot) {
                row.boot=true;
                state.document.rows.forEach(r=>{if(r.boot) r.boot=false;});
            }
            state.document.rows=state.document.rows.filter(r=>r!==original).concat([row]).sort((a,b)=>a.slot-b.slot);
            overlay.remove(); changed();
        };
        name.focus();
        try {
            const response=await fetch('/api/lumps/list');
            if(!response.ok) throw Error('Saved LUMP list unavailable; name-only placement remains available');
            const data=await response.json();
            records=Array.isArray(data)?data:(data.lumps || []);
            records.forEach((r,i)=>{
                const option=document.createElement('option');
                option.value=String(i); option.textContent=(r.abstraction || r.name || r.filename)+' — '+r.filename;
                picker.appendChild(option);
            });
        } catch(e) { overlay.querySelector('#nsDraftError').textContent=e.message; }
    }
    async function save() {
        if(state.saving || !state.document) return;
        state.saving=true; render();
        try { accept(await request('PUT',{fingerprint:state.fingerprint,document:clone(state.document)})); }
        catch(e) { state.error=e.message+' No executable image was changed. Your draft is retained.'; }
        finally { state.saving=false; render(); }
    }
    root.NamespaceDesignV1={state,render,load,save,edit,inspect,source,clear,setProfile};
    if(typeof document!=='undefined') {
        if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',render);
        else render();
    }
})(typeof window!=='undefined'?window:globalThis);
